// input: Injected Project identities, live Session objects, and controlled drain/snapshot hooks
// output: Independent regression coverage for transition ownership and invalidation recovery order
// pos: Tests Project lifecycle coordination without a SessionManager or Pi runtime
import { expect, it } from 'bun:test'
import { tmpdir } from 'node:os'
import type { Workspace } from '@craft-agent/shared/config'
import { createManagedSession } from './managed-session'
import { ProjectLifecycleCoordinator, ProjectLifecycleTransitionError, type ProjectLifecycleCoordinatorDeps } from './project-lifecycle-coordinator'

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}

function fixture(overrides: Partial<ProjectLifecycleCoordinatorDeps> = {}) {
  const workspace: Workspace = { id: 'project', name: 'Project', slug: 'project', rootPath: tmpdir(), createdAt: 1 }
  const managed = createManagedSession({ id: 'session' }, workspace, { messagesLoaded: true })
  const sessions = new Map([[managed.id, managed]])
  const events: string[] = []
  const coordinator = new ProjectLifecycleCoordinator({
    getStoredWorkspace: id => id === workspace.id ? workspace : undefined,
    resolveWorkspace: id => id === workspace.id ? workspace : undefined,
    sessions: () => sessions,
    isShuttingDown: () => false,
    drainSession: async () => { events.push('drain') },
    getActiveSessionCount: () => 0,
    setupConfigWatcher: () => {},
    removeWorkspaceLocked: async () => { throw new Error('unexpected removal') },
    rebindWorkspaceRootLocked: async () => { throw new Error('unexpected relink') },
    enqueueInvalidationSnapshot: session => { events.push(`snapshot:${session.runtimeState}`) },
    recoverQueuedMessages: session => {
      coordinator.assertProjectLifecycleAvailable(workspace.id, [coordinator.projectRootLifecycleKey(workspace.rootPath)])
      events.push(`recover:${session.runtimeState}`)
    },
    ...overrides,
  })
  return { coordinator, workspace, managed, sessions, events }
}

it('owns Project and root transitions until release, and rejects stale-token release', async () => {
  const { coordinator, workspace } = fixture()
  const keys = [coordinator.projectRootLifecycleKey(workspace.rootPath)]
  const claim = coordinator.beginProjectTransition(workspace, keys)
  await expect(coordinator.withProjectLifecycle(workspace.id, async () => {})).rejects.toBeInstanceOf(ProjectLifecycleTransitionError)
  expect(() => coordinator.assertProjectLifecycleAvailable(undefined, keys)).toThrow(ProjectLifecycleTransitionError)
  await coordinator.withProjectLifecycleLock(workspace.id, async () => {}, claim.token)
  const replacement = coordinator.beginProjectTransition(workspace, keys)
  coordinator.releaseProjectTransition(claim)
  expect(() => coordinator.assertProjectLifecycleAvailable(workspace.id, keys)).toThrow(ProjectLifecycleTransitionError)
  coordinator.releaseProjectTransition(replacement)
  await expect(coordinator.withProjectLifecycle(workspace.id, async () => 'open')).resolves.toBe('open')
})

it('serializes lifecycle work and releases a failed lock holder', async () => {
  const { coordinator, workspace } = fixture()
  const entered = gate(), release = gate()
  const events: string[] = []
  const first = coordinator.withProjectLifecycle(workspace.id, async () => {
    events.push('first'); entered.resolve(); await release.promise; throw new Error('failed work')
  }).catch(error => error)
  await entered.promise
  const second = coordinator.withProjectLifecycle(workspace.id, async () => { events.push('second') })
  expect(events).toEqual(['first'])
  release.resolve()
  expect((await first).message).toBe('failed work')
  await second
  expect(events).toEqual(['first', 'second'])
})

it('drains accepted Project operations before a transition can commit', async () => {
  const { coordinator, workspace } = fixture()
  const entered = gate(), release = gate()
  const operation = coordinator.withProjectOperation(workspace.id, async () => {
    entered.resolve(); await release.promise
  })
  await entered.promise
  const claim = coordinator.beginProjectTransition(workspace, [])
  let drained = false
  const drain = claim.operationsDrained.then(() => { drained = true })
  await Promise.resolve()
  expect(drained).toBe(false)
  await expect(coordinator.withProjectOperation(workspace.id, async () => {})).rejects.toBeInstanceOf(ProjectLifecycleTransitionError)
  release.resolve()
  await operation
  await drain
  expect(drained).toBe(true)
  coordinator.releaseProjectTransition(claim)
})

it('snapshots before restoring invalidation and recovers queues only after releasing ownership', () => {
  const { coordinator, workspace, managed, events } = fixture()
  const keys = [coordinator.projectRootLifecycleKey(workspace.rootPath)]
  const claim = coordinator.beginProjectInvalidation(workspace, [managed], keys)
  expect(managed.runtimeEpoch).toBe(1)
  expect(managed.runtimeState).toBe('invalidating')
  coordinator.restoreProjectInvalidation(claim)
  expect(events).toEqual(['snapshot:invalidating'])
  expect(managed.runtimeState).toBeUndefined()
  expect(() => coordinator.assertProjectLifecycleAvailable(workspace.id, keys)).toThrow(ProjectLifecycleTransitionError)
  coordinator.releaseProjectTransition(claim)
  expect(events).toEqual(['snapshot:invalidating', 'recover:undefined'])
})

it('does not restore stale epochs or recover replaced/closing Sessions', () => {
  const { coordinator, workspace, managed, sessions, events } = fixture()
  const claim = coordinator.beginProjectInvalidation(workspace, [managed], [])
  managed.runtimeEpoch = (managed.runtimeEpoch ?? 0) + 1
  coordinator.restoreProjectInvalidation(claim)
  coordinator.releaseProjectTransition(claim)
  expect(events).toEqual([])
  managed.runtimeState = undefined
  sessions.delete(managed.id)
  coordinator.releaseProjectTransition(claim)
  expect(events).toEqual([])
})

it('restores and releases exclusive ownership when work fails', async () => {
  const { coordinator, workspace, managed, events } = fixture()
  await expect(coordinator.withProjectExclusiveOperation(workspace.id, async () => {
    expect(managed.runtimeState).toBe('invalidating')
    throw new Error('exclusive failure')
  })).rejects.toThrow('exclusive failure')
  expect(events).toEqual(['drain', 'snapshot:invalidating', 'recover:undefined'])
  await expect(coordinator.withProjectOperation(workspace.id, async () => 'restored')).resolves.toBe('restored')
})

it('does not replay queued work during Host shutdown', () => {
  const { coordinator, workspace, managed, events } = fixture({ isShuttingDown: () => true })
  const claim = coordinator.beginProjectInvalidation(workspace, [managed], [])
  coordinator.restoreProjectInvalidation(claim)
  coordinator.releaseProjectTransition(claim)
  expect(events).toEqual(['snapshot:invalidating'])
})
