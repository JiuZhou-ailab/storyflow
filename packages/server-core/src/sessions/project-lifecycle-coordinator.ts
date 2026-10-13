// input: Project identity resolution, live Sessions, runtime draining, and persistence recovery hooks
// output: Project/root transition ownership, operation draining, and epoch-checked invalidation recovery
// pos: Owns Project lifecycle coordination independently of Session turn execution

import { getWorkspaces, type Workspace } from '@craft-agent/shared/config'
import { canonicalizeProjectRoot, isFreeConversationWorkspaceId, prepareWorkspaceRootRelink } from '@craft-agent/shared/workspaces'
import type { ManagedSession } from './managed-session'
import { getSessionLog } from './session-runtime'

export interface ProjectTransitionClaim {
  token: symbol
  workspace: Workspace
  rootKeys: string[]
  operationsDrained: Promise<void>
}

export interface ProjectInvalidationClaim extends ProjectTransitionClaim {
  sessions: ManagedSession[]
  runtimeEpochs: Map<string, number>
}

export interface WorkspaceRelinkClaim extends ProjectInvalidationClaim {
  plan: ReturnType<typeof prepareWorkspaceRootRelink>
}

export class ProjectLifecycleTransitionError extends Error {}

export interface ProjectLifecycleCoordinatorDeps {
  getStoredWorkspace(projectId: string): Workspace | undefined
  resolveWorkspace(projectId: string): Workspace | null | undefined
  sessions(): ReadonlyMap<string, ManagedSession>
  isShuttingDown(): boolean
  drainSession(managed: ManagedSession, disposeReason?: string): Promise<void>
  getActiveSessionCount(projectId: string): number
  setupConfigWatcher(rootPath: string, projectId: string): void
  removeWorkspaceLocked(claim: ProjectInvalidationClaim): Promise<boolean>
  rebindWorkspaceRootLocked(claim: WorkspaceRelinkClaim): Promise<Workspace>
  enqueueInvalidationSnapshot(managed: ManagedSession): void
  recoverQueuedMessages(managed: ManagedSession): void
}

export class ProjectLifecycleCoordinator {
  constructor(private readonly deps: ProjectLifecycleCoordinatorDeps) {}

  /** Serializes Project identity changes with every operation that creates durable Sessions. */
  private projectLifecycleTails = new Map<string, Promise<void>>()
  /** Logical ownership spans the lock-free runtime-drain phase of remove/relink. */
  private projectLifecycleTransitions = new Map<string, symbol>()
  private projectRootLifecycleTransitions = new Map<string, symbol>()
  /** Accepted lock-free Project work that transitions must drain before commit. */
  private projectOperationCounts = new Map<string, number>()
  private projectOperationDrainWaiters = new Map<string, Set<() => void>>()

  async withLifecycleLockKey<T>(
    key: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = this.projectLifecycleTails.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(resolve => { release = resolve })
    const tail = previous.then(() => current)
    this.projectLifecycleTails.set(key, tail)
    await previous

    try {
      return await work()
    } finally {
      release()
      if (this.projectLifecycleTails.get(key) === tail) {
        this.projectLifecycleTails.delete(key)
      }
    }
  }

  private async withLifecycleRootKeys<T>(
    keys: readonly string[],
    work: () => Promise<T>,
  ): Promise<T> {
    const orderedKeys = [...new Set(keys)].sort()
    const acquire = (index: number): Promise<T> => (
      index === orderedKeys.length
        ? work()
        : this.withLifecycleLockKey(orderedKeys[index], () => acquire(index + 1))
    )
    return acquire(0)
  }

  projectRootLifecycleKey(rootPath: string): string {
    const canonicalRoot = canonicalizeProjectRoot(rootPath, true)
    return `root:${process.platform === 'win32' ? canonicalRoot.toLowerCase() : canonicalRoot}`
  }

  assertProjectLifecycleAvailable(
    projectId: string | undefined,
    rootKeys: readonly string[],
    token?: symbol,
  ): void {
    if (this.deps.isShuttingDown()) throw new Error('Host is shutting down')
    const projectOwner = projectId
      ? this.projectLifecycleTransitions.get(projectId)
      : undefined
    if (projectOwner && projectOwner !== token) {
      throw new ProjectLifecycleTransitionError(`Project ${projectId} is being removed or relinked; retry this operation.`)
    }
    const busyRoot = rootKeys.find(key => {
      const owner = this.projectRootLifecycleTransitions.get(key)
      return owner && owner !== token
    })
    if (busyRoot) {
      throw new ProjectLifecycleTransitionError('The selected Project directory is being removed or relinked; retry this operation.')
    }
  }

  async withProjectLifecycleLock<T>(
    workspaceId: string,
    work: () => Promise<T>,
    transitionToken?: symbol,
  ): Promise<T> {
    if (isFreeConversationWorkspaceId(workspaceId)) {
      this.assertProjectLifecycleAvailable(workspaceId, [], transitionToken)
      return work()
    }

    const projectKey = `project:${workspaceId}`
    const workspace = this.deps.getStoredWorkspace(workspaceId)
    const rootKey = workspace && !workspace.remoteServer
      ? this.projectRootLifecycleKey(workspace.rootPath)
      : undefined
    this.assertProjectLifecycleAvailable(workspaceId, rootKey ? [rootKey] : [], transitionToken)
    let retry = false
    let outcome: { value: T } | undefined
    await this.withLifecycleRootKeys(
      rootKey ? [rootKey] : [],
      () => this.withLifecycleLockKey(projectKey, async () => {
        const current = this.deps.getStoredWorkspace(workspaceId)
        const currentRootKey = current && !current.remoteServer
          ? this.projectRootLifecycleKey(current.rootPath)
          : undefined
        if (currentRootKey !== rootKey) {
          retry = true
          return
        }
        this.assertProjectLifecycleAvailable(workspaceId, rootKey ? [rootKey] : [], transitionToken)
        outcome = { value: await work() }
      }),
    )
    if (retry) return this.withProjectLifecycleLock(workspaceId, work, transitionToken)
    return outcome!.value
  }

  async withWorkspaceRootRelinkLock<T>(
    projectId: string,
    targetRoot: string,
    work: () => Promise<T>,
    transitionToken?: symbol,
  ): Promise<T> {
    const projectKey = `project:${projectId}`
    const targetKey = this.projectRootLifecycleKey(targetRoot)
    const workspace = this.deps.getStoredWorkspace(projectId)
    const previousRootKey = workspace && !workspace.remoteServer
      ? this.projectRootLifecycleKey(workspace.rootPath)
      : undefined
    this.assertProjectLifecycleAvailable(
      projectId,
      previousRootKey ? [previousRootKey, targetKey] : [targetKey],
      transitionToken,
    )

    let retry = false
    let outcome: { value: T } | undefined
    await this.withLifecycleRootKeys(
      previousRootKey ? [previousRootKey, targetKey] : [targetKey],
      () => this.withLifecycleLockKey(projectKey, async () => {
        const current = this.deps.getStoredWorkspace(projectId)
        const currentRootKey = current && !current.remoteServer
          ? this.projectRootLifecycleKey(current.rootPath)
          : undefined
        if (currentRootKey !== previousRootKey) {
          retry = true
          return
        }
        this.assertProjectLifecycleAvailable(
          projectId,
          previousRootKey ? [previousRootKey, targetKey] : [targetKey],
          transitionToken,
        )
        outcome = { value: await work() }
      }),
    )
    if (retry) return this.withWorkspaceRootRelinkLock(projectId, targetRoot, work, transitionToken)
    return outcome!.value
  }

  beginProjectInvalidation(
    workspace: Workspace,
    sessions: ManagedSession[],
    rootKeys: string[],
  ): ProjectInvalidationClaim {
    const busySession = sessions.find(managed => managed.runtimeState)
    if (busySession) {
      throw new Error(`Session ${busySession.id} is already being changed; retry the Project operation.`)
    }

    const transition = this.beginProjectTransition(workspace, rootKeys)
    const runtimeEpochs = new Map<string, number>()
    for (const managed of sessions) {
      managed.runtimeState = 'invalidating'
      managed.runtimeEpoch = (managed.runtimeEpoch ?? 0) + 1
      runtimeEpochs.set(managed.id, managed.runtimeEpoch)
    }
    return { ...transition, sessions, runtimeEpochs }
  }

  beginProjectTransition(workspace: Workspace, rootKeys: string[]): ProjectTransitionClaim {
    const token = Symbol(workspace.id)
    this.projectLifecycleTransitions.set(workspace.id, token)
    for (const rootKey of rootKeys) this.projectRootLifecycleTransitions.set(rootKey, token)
    return {
      token,
      workspace,
      rootKeys,
      operationsDrained: this.waitForProjectOperations(workspace.id),
    }
  }

  private retainProjectOperation(projectId: string): () => void {
    this.projectOperationCounts.set(projectId, (this.projectOperationCounts.get(projectId) ?? 0) + 1)
    let retained = true
    return () => {
      if (!retained) return
      retained = false
      const remaining = (this.projectOperationCounts.get(projectId) ?? 1) - 1
      if (remaining > 0) {
        this.projectOperationCounts.set(projectId, remaining)
        return
      }
      this.projectOperationCounts.delete(projectId)
      const waiters = this.projectOperationDrainWaiters.get(projectId)
      this.projectOperationDrainWaiters.delete(projectId)
      for (const resolve of waiters ?? []) resolve()
    }
  }

  private waitForProjectOperations(projectId: string): Promise<void> {
    if ((this.projectOperationCounts.get(projectId) ?? 0) === 0) return Promise.resolve()
    return new Promise(resolve => {
      const waiters = this.projectOperationDrainWaiters.get(projectId) ?? new Set<() => void>()
      waiters.add(resolve)
      this.projectOperationDrainWaiters.set(projectId, waiters)
    })
  }

  ownsProjectInvalidation(claim: ProjectInvalidationClaim, managed: ManagedSession): boolean {
    return this.deps.sessions().get(managed.id) === managed
      && managed.runtimeState === 'invalidating'
      && managed.runtimeEpoch === claim.runtimeEpochs.get(managed.id)
  }

  restoreProjectInvalidation(claim: ProjectInvalidationClaim): void {
    for (const managed of claim.sessions) {
      if (this.ownsProjectInvalidation(claim, managed)) {
        this.deps.enqueueInvalidationSnapshot(managed)
        managed.runtimeState = undefined
      }
    }
  }

  releaseProjectTransition(claim: ProjectTransitionClaim | ProjectInvalidationClaim): void {
    if (this.projectLifecycleTransitions.get(claim.workspace.id) === claim.token) {
      this.projectLifecycleTransitions.delete(claim.workspace.id)
    }
    for (const rootKey of claim.rootKeys) {
      if (this.projectRootLifecycleTransitions.get(rootKey) === claim.token) {
        this.projectRootLifecycleTransitions.delete(rootKey)
      }
    }
    if (!('sessions' in claim)) return
    for (const managed of claim.sessions) {
      if (this.deps.sessions().get(managed.id) === managed && !managed.runtimeState && !this.deps.isShuttingDown()) {
        this.deps.recoverQueuedMessages(managed)
      }
    }
  }

  async withProjectLifecycle<T>(
    projectId: string,
    work: (workspace: Workspace) => Promise<T>,
  ): Promise<T> {
    const resolved = this.deps.resolveWorkspace(projectId)
    if (!resolved) throw new Error(`Project not found: ${projectId}`)
    const canonicalProjectId = resolved.id
    return this.withProjectLifecycleLock(canonicalProjectId, async () => {
      const workspace = this.deps.resolveWorkspace(canonicalProjectId)
      if (!workspace) throw new Error(`Project not found: ${projectId}`)
      return work(workspace)
    })
  }

  async withProjectOperation<T>(
    projectId: string,
    work: (workspace: Workspace) => Promise<T>,
  ): Promise<T> {
    const resolved = this.deps.resolveWorkspace(projectId)
    if (!resolved) throw new Error(`Project not found: ${projectId}`)
    const canonicalProjectId = resolved.id
    const lease = await this.withProjectLifecycleLock(canonicalProjectId, async () => {
      const workspace = this.deps.resolveWorkspace(canonicalProjectId)
      if (!workspace) throw new Error(`Project not found: ${projectId}`)
      return {
        workspace,
        release: this.retainProjectOperation(canonicalProjectId),
      }
    })
    try {
      return await work(lease.workspace)
    } finally {
      lease.release()
    }
  }

  async withProjectExclusiveOperation<T>(
    projectId: string,
    work: (workspace: Workspace) => Promise<T>,
  ): Promise<T> {
    const resolved = this.deps.resolveWorkspace(projectId)
    if (!resolved) throw new Error(`Project not found: ${projectId}`)
    const canonicalProjectId = resolved.id
    const transition = await this.withProjectLifecycleLock(canonicalProjectId, async () => {
      const workspace = this.deps.resolveWorkspace(canonicalProjectId)
      if (!workspace) throw new Error(`Project not found: ${projectId}`)
      const sessions = [...this.deps.sessions().values()]
        .filter(managed => managed.workspace.id === canonicalProjectId)
      return this.beginProjectInvalidation(
        workspace,
        sessions,
        workspace.remoteServer ? [] : [this.projectRootLifecycleKey(workspace.rootPath)],
      )
    })
    try {
      await transition.operationsDrained
      for (const managed of transition.sessions) {
        await this.deps.drainSession(managed)
      }
      return await work(transition.workspace)
    } finally {
      try {
        this.restoreProjectInvalidation(transition)
      } finally {
        this.releaseProjectTransition(transition)
      }
    }
  }

  async removeWorkspace(projectId: string): Promise<boolean> {
    const claim = await this.withProjectLifecycleLock(projectId, async () => {
      const workspace = getWorkspaces().find(candidate => candidate.id === projectId)
      if (!workspace) return false
      if (this.deps.getActiveSessionCount(projectId) > 0) {
        throw new Error('Stop all running sessions before removing this Project.')
      }
      const sessions = [...this.deps.sessions().values()]
        .filter(managed => managed.workspace.id === projectId)
      const rootKeys = workspace.remoteServer
        ? []
        : [this.projectRootLifecycleKey(workspace.rootPath)]
      return this.beginProjectInvalidation(workspace, sessions, rootKeys)
    })
    if (!claim) return false

    try {
      await claim.operationsDrained
      // A Pi turn may call spawn_session, so runtime drain must never retain
      // the Project/root locks. The logical transition makes that call fail fast.
      for (const managed of claim.sessions) {
        await this.deps.drainSession(managed, 'workspace removal')
      }
      return await this.withProjectLifecycleLock(
        projectId,
        () => this.deps.removeWorkspaceLocked(claim),
        claim.token,
      )
    } catch (error) {
      this.restoreProjectInvalidation(claim)
      try {
        this.deps.setupConfigWatcher(claim.workspace.rootPath, projectId)
      } catch (watcherError) {
        getSessionLog().error('Failed to restore Project watcher after removal error:', watcherError)
      }
      throw error
    } finally {
      this.releaseProjectTransition(claim)
    }
  }

  async rebindWorkspaceRoot(projectId: string, currentRoot: string): Promise<Workspace> {
    const claim = await this.withWorkspaceRootRelinkLock(
      projectId,
      currentRoot,
      async () => {
        if (this.deps.getActiveSessionCount(projectId) > 0) {
          throw new Error('Stop all running sessions before relinking this Project.')
        }
        const sessions = [...this.deps.sessions().values()]
          .filter(managed => managed.workspace.id === projectId)
        const plan = prepareWorkspaceRootRelink(
          projectId,
          currentRoot,
          sessions.map(managed => managed.id),
        )
        const invalidation = this.beginProjectInvalidation(
          plan.workspace,
          sessions,
          [
            this.projectRootLifecycleKey(plan.previousRoot),
            this.projectRootLifecycleKey(plan.currentRoot),
          ],
        )
        return { ...invalidation, plan }
      },
    )

    let updated: Workspace
    try {
      await claim.operationsDrained
      for (const managed of claim.sessions) {
        await this.deps.drainSession(managed, 'workspace root relink')
      }
      updated = await this.withWorkspaceRootRelinkLock(
        projectId,
        currentRoot,
        () => this.deps.rebindWorkspaceRootLocked(claim),
        claim.token,
      )
    } catch (error) {
      this.restoreProjectInvalidation(claim)
      try {
        this.deps.setupConfigWatcher(claim.plan.previousRoot, projectId)
      } catch (watcherError) {
        getSessionLog().error('Failed to restore Project watcher after relink error:', watcherError)
      }
      throw error
    } finally {
      this.releaseProjectTransition(claim)
    }
    return updated
  }

}
