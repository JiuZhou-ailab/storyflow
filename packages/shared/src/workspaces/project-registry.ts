// input: Host Project registrations, selected local roots, and project-owned Session metadata
// output: Canonical Project registration, Host-owned Pi cwd grants, compatibility migration, availability, and relinking
// pos: Product Host boundary that keeps stable Project identity separate from its filesystem locator

import { existsSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'
import type { Workspace } from '@craft-agent/core/types'
import {
  addWorkspace,
  getWorkspaces,
  loadStoredConfig,
  saveConfig,
} from '../config/storage.ts'
import { listSessions, listSessionsAsync } from '../sessions/storage.ts'
import { normalizePathForComparison, pathStartsWith } from '../utils/paths.ts'
import { extractWorkspaceSlugFromPath } from '../utils/workspace-slug.ts'
import { getWorkspaceConfigPath, rebasePathWithinProjectRoot } from './paths.ts'
import {
  createWorkspaceAtPath,
  inspectWorkspaceConfig,
  inspectWorkspaceStateConfig,
  loadWorkspaceConfig,
  saveWorkspaceConfig,
} from './storage.ts'

export function canonicalizeProjectRoot(rootPath: string, allowMissing = false): string {
  const absolute = resolve(rootPath)
  let candidate = absolute
  while (true) {
    try {
      if (!statSync(candidate).isDirectory()) {
        throw new Error(`Not a directory: ${candidate}`)
      }
      return resolve(realpathSync(candidate), relative(candidate, absolute))
    } catch (error) {
      if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(candidate)
      if (parent === candidate) return absolute
      candidate = parent
    }
  }
}

function sameRoot(left: string, right: string): boolean {
  return normalizePathForComparison(canonicalizeProjectRoot(left, true))
    === normalizePathForComparison(canonicalizeProjectRoot(right, true))
}

function assertProjectDirectoryIsUnclaimed(
  candidateConfigId: string,
  excludedProjectId?: string,
): void {
  for (const workspace of getWorkspaces()) {
    if (workspace.id === excludedProjectId || workspace.remoteServer) continue

    if (workspace.directoryConfigId === candidateConfigId) {
      throw new Error(`This Project content is already registered as "${workspace.name}". Relink that Project instead.`)
    }

    const registeredConfig = inspectWorkspaceStateConfig(workspace.rootPath)
    if (!registeredConfig) continue

    if (registeredConfig.id === candidateConfigId) {
      throw new Error(`This Project content is already registered as "${workspace.name}".`)
    }
  }
}

function assertProjectContentIsUnclaimed(
  candidateRoot: string,
  candidateConfigId: string,
  excludedProjectId?: string,
): void {
  assertProjectDirectoryIsUnclaimed(candidateConfigId, excludedProjectId)
  const candidateSessionIds = new Set(listSessions(candidateRoot).map(session => session.id))

  for (const workspace of getWorkspaces()) {
    if (workspace.id === excludedProjectId || workspace.remoteServer) continue

    if (candidateSessionIds.size === 0) continue
    const duplicateSession = listSessions(workspace.rootPath)
      .find(session => candidateSessionIds.has(session.id))
    if (duplicateSession) {
      throw new Error(
        `Session ${duplicateSession.id} already belongs to "${workspace.name}". Import or clone the Project instead.`,
      )
    }
  }
}

export function isWorkspaceRootAvailable(workspace: Workspace): boolean {
  if (workspace.remoteServer) return true
  const config = inspectWorkspaceStateConfig(workspace.rootPath)
  return Boolean(config && workspace.directoryConfigId === config.id)
}

/** Resolve a Pi cwd only from the Project root or a canonical Host grant. */
export function resolveWorkspaceWorkingDirectory(
  workspace: Workspace,
  requestedPath: string,
  allowMissing = false,
): string {
  if (workspace.remoteServer) {
    throw new Error('Remote Project working directories must be resolved by their Host.')
  }

  const canonicalRoot = canonicalizeProjectRoot(workspace.rootPath)
  const directoryConfig = inspectWorkspaceStateConfig(canonicalRoot)
  if (!directoryConfig || workspace.directoryConfigId !== directoryConfig.id) {
    throw new Error(`Project directory is unavailable; relink Project ${workspace.id} before using a working directory.`)
  }
  return resolveVerifiedWorkspaceWorkingDirectoryFromRoot(
    workspace,
    canonicalRoot,
    requestedPath,
    allowMissing,
  )
}

function resolveVerifiedWorkspaceWorkingDirectoryFromRoot(
  workspace: Workspace,
  canonicalRoot: string,
  requestedPath: string,
  allowMissing: boolean,
): string {
  const canonicalWorkingDirectory = canonicalizeProjectRoot(requestedPath, allowMissing)
  const grantedRoots = workspace.grantedWorkingDirectoryRoots ?? []
  if (
    !pathStartsWith(canonicalWorkingDirectory, canonicalRoot)
    && !grantedRoots.some(root => pathStartsWith(canonicalWorkingDirectory, root))
  ) {
    throw new Error('Working directory is not authorized for this Project. Select the folder again.')
  }
  return canonicalWorkingDirectory
}

/** Resolve cwd after the caller has already verified this exact Project snapshot. */
export function resolveVerifiedWorkspaceWorkingDirectory(
  workspace: Workspace,
  requestedPath: string,
  allowMissing = false,
): string {
  if (workspace.remoteServer) {
    throw new Error('Remote Project working directories must be resolved by their Host.')
  }
  return resolveVerifiedWorkspaceWorkingDirectoryFromRoot(
    workspace,
    workspace.rootPath,
    requestedPath,
    allowMissing,
  )
}

/** Persist one explicit Host authorization and return its canonical Pi cwd. */
export function grantWorkspaceWorkingDirectory(projectId: string, requestedPath: string) {
  const config = loadStoredConfig()
  const project = config?.workspaces.find(workspace => workspace.id === projectId)
  if (!config || !project) throw new Error(`Project not found: ${projectId}`)
  if (project.remoteServer) {
    throw new Error('Remote Project working directories must be granted by their Host.')
  }

  const canonicalRoot = canonicalizeProjectRoot(project.rootPath)
  const canonicalWorkingDirectory = canonicalizeProjectRoot(requestedPath)
  const grantedRoots = project.grantedWorkingDirectoryRoots ?? []
  if (
    pathStartsWith(canonicalWorkingDirectory, canonicalRoot)
    || grantedRoots.some(root => pathStartsWith(canonicalWorkingDirectory, root))
  ) {
    return { workspace: { ...project }, workingDirectory: canonicalWorkingDirectory }
  }

  const directoryConfig = inspectWorkspaceStateConfig(canonicalRoot)
  if (!directoryConfig || project.directoryConfigId !== directoryConfig.id) {
    throw new Error(`Project directory is unavailable; relink Project ${project.id} before selecting a working directory.`)
  }

  project.grantedWorkingDirectoryRoots = [
    ...grantedRoots.filter(root => !pathStartsWith(root, canonicalWorkingDirectory)),
    canonicalWorkingDirectory,
  ]
  saveConfig(config)
  return { workspace: { ...project }, workingDirectory: canonicalWorkingDirectory }
}

/** Discover legacy cwd capabilities before the Host commits a Project locator. */
export async function discoverLegacyWorkingDirectoryRoots(project: Workspace, canonicalRoot: string): Promise<string[]> {
  const directoryConfig = loadWorkspaceConfig(canonicalRoot)
  if (!directoryConfig || directoryConfig.id !== project.directoryConfigId) {
    throw new Error('stored locator changed while working directories were being migrated')
  }

  const candidates = [
    directoryConfig.defaults?.workingDirectory,
    ...(await listSessionsAsync(canonicalRoot, false)).map(session => session.workingDirectory),
  ]
  const grantedRoots: string[] = []
  for (const candidate of candidates) {
    if (!candidate) continue
    const canonicalWorkingDirectory = canonicalizeProjectRoot(candidate, true)
    if (pathStartsWith(canonicalWorkingDirectory, canonicalRoot)) continue
    if (grantedRoots.some(root => pathStartsWith(canonicalWorkingDirectory, root))) continue
    grantedRoots.splice(
      0,
      grantedRoots.length,
      ...grantedRoots.filter(root => !pathStartsWith(root, canonicalWorkingDirectory)),
      canonicalWorkingDirectory,
    )
  }
  return grantedRoots
}

/** Upgrade one reachable v0.17 Host registration without holding a stale config across I/O. */
export async function migrateLegacyLocalProjectDirectoryIdentity(projectId: string) {
  const initialConfig = loadStoredConfig()
  const initial = initialConfig?.workspaces.find(project => project.id === projectId)
  if (!initialConfig || !initial) throw new Error(`Project not found: ${projectId}`)
  if (initial.remoteServer) return { applied: false, restoredDirectoryIdentity: false }

  const initialRoot = initial.rootPath
  const canonicalRoot = canonicalizeProjectRoot(initialRoot)
  if (
    initialRoot === canonicalRoot
    && initial.directoryConfigId
    && initial.grantedWorkingDirectoryRoots !== undefined
  ) return { applied: false, restoredDirectoryIdentity: false }
  const directoryConfig = inspectWorkspaceStateConfig(canonicalRoot)
  if (!directoryConfig) throw new Error('stored locator is not a valid Storyflow Project')
  if (initial.directoryConfigId && initial.directoryConfigId !== directoryConfig.id) {
    throw new Error('stored locator no longer matches the Project directory identity')
  }
  const initiallyClaimedBy = initialConfig.workspaces.find(project => (
    project.id !== projectId && project.directoryConfigId === directoryConfig.id
  ))
  if (initiallyClaimedBy) {
    throw new Error(`directory identity is already claimed by Project ${initiallyClaimedBy.id}`)
  }

  const directoryConfigId = initial.directoryConfigId ?? directoryConfig.id
  let grantedRoots = initial.grantedWorkingDirectoryRoots
  let unresolvedReason: string | undefined
  if (grantedRoots === undefined) {
    try {
      grantedRoots = await discoverLegacyWorkingDirectoryRoots(
        { ...initial, directoryConfigId },
        canonicalRoot,
      )
    } catch (error) {
      unresolvedReason = error instanceof Error ? error.message : String(error)
    }
  }

  const config = loadStoredConfig()
  const project = config?.workspaces.find(candidate => candidate.id === projectId)
  if (!config || !project || project.rootPath !== initialRoot || project.remoteServer) {
    throw new Error('Project registration changed while its directory identity was being migrated')
  }
  if (project.directoryConfigId && project.directoryConfigId !== directoryConfig.id) {
    throw new Error('Project directory identity changed while it was being migrated')
  }
  const currentDirectoryConfig = inspectWorkspaceStateConfig(canonicalRoot)
  if (!currentDirectoryConfig || currentDirectoryConfig.id !== directoryConfig.id) {
    throw new Error('stored locator changed while its directory identity was being migrated')
  }
  const claimedBy = config.workspaces.find(candidate => (
    candidate.id !== projectId && candidate.directoryConfigId === directoryConfig.id
  ))
  if (claimedBy) {
    throw new Error(`directory identity is already claimed by Project ${claimedBy.id}`)
  }

  const restoredDirectoryIdentity = !project.directoryConfigId
  project.rootPath = canonicalRoot
  project.slug = extractWorkspaceSlugFromPath(canonicalRoot, project.id)
  project.directoryConfigId = directoryConfig.id
  if (grantedRoots !== undefined) project.grantedWorkingDirectoryRoots ??= grantedRoots
  saveConfig(config)
  return { applied: true, restoredDirectoryIdentity, unresolvedReason }
}

/** Upgrade each reachable v0.17 Host registration; unresolved Projects retry next startup. */
export async function migrateLegacyLocalProjectDirectoryIdentities() {
  const config = loadStoredConfig()
  if (!config) {
    return { applied: false, restoredProjectIds: [], unresolvedProjects: [] }
  }

  const restoredProjectIds: string[] = []
  const unresolvedProjects: Array<{ projectId: string; reason: string }> = []
  let changed = false
  for (const project of config.workspaces) {
    try {
      const result = await migrateLegacyLocalProjectDirectoryIdentity(project.id)
      changed ||= result.applied
      if (result.restoredDirectoryIdentity) restoredProjectIds.push(project.id)
      if (result.unresolvedReason) {
        unresolvedProjects.push({ projectId: project.id, reason: result.unresolvedReason })
      }
    } catch (error) {
      unresolvedProjects.push({
        projectId: project.id,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { applied: changed, restoredProjectIds, unresolvedProjects }
}

/** Register a selected local directory without copying directory-owned identity into the Host identity. */
export function registerLocalProject(name: string, rootPath: string): Workspace {
  const canonicalRoot = canonicalizeProjectRoot(rootPath, true)
  const registered = getWorkspaces()
  const existing = registered.find(workspace => sameRoot(workspace.rootPath, canonicalRoot))
  if (existing) {
    const inspectedConfig = inspectWorkspaceConfig(canonicalRoot)
    if (
      !inspectedConfig
      || (existing.directoryConfigId && existing.directoryConfigId !== inspectedConfig.id)
    ) {
      throw new Error(
        `This directory no longer matches "${existing.name}". Relink the original Project or remove its stale registration before adding this directory.`,
      )
    }
    assertProjectContentIsUnclaimed(canonicalRoot, inspectedConfig.id, existing.id)
    const directoryConfig = loadWorkspaceConfig(canonicalRoot)
    if (!directoryConfig || directoryConfig.id !== inspectedConfig.id) {
      throw new Error(`Failed to verify Storyflow Project: ${canonicalRoot}`)
    }
    if (!existing.directoryConfigId) {
      const hostConfig = loadStoredConfig()
      const hostProject = hostConfig?.workspaces.find(workspace => workspace.id === existing.id)
      if (!hostConfig || !hostProject || !sameRoot(hostProject.rootPath, canonicalRoot)) {
        throw new Error('The Project registration changed while the directory was being verified.')
      }
      hostProject.directoryConfigId = directoryConfig.id
      saveConfig(hostConfig)
    }
    return { ...existing, directoryConfigId: directoryConfig.id, rootAvailable: true }
  }

  const inspectedConfig = inspectWorkspaceStateConfig(canonicalRoot)
  if (existsSync(getWorkspaceConfigPath(canonicalRoot)) && !inspectedConfig) {
    throw new Error(`Invalid Storyflow Project configuration: ${canonicalRoot}`)
  }
  if (inspectedConfig) {
    assertProjectContentIsUnclaimed(canonicalRoot, inspectedConfig.id)
  }

  const directoryConfig = inspectedConfig
    ? loadWorkspaceConfig(canonicalRoot)
    : createWorkspaceAtPath(canonicalRoot, name)
  if (!directoryConfig) throw new Error(`Failed to initialize Storyflow Project: ${canonicalRoot}`)

  return addWorkspace({
    name: directoryConfig.name || name,
    rootPath: canonicalRoot,
    directoryConfigId: directoryConfig.id,
    grantedWorkingDirectoryRoots: [],
  })
}

export interface WorkspaceRootRelinkPlan {
  projectId: string
  previousRoot: string
  currentRoot: string
  directoryConfigId: string
  workspace: Workspace
}

/** Validate a relink target without mutating the target directory or Host registry. */
export function prepareWorkspaceRootRelink(
  projectId: string,
  rootPath: string,
  expectedSessionIds: readonly string[] = [],
): WorkspaceRootRelinkPlan {
  const config = loadStoredConfig()
  if (!config) throw new Error('Config not found')

  const project = config.workspaces.find(workspace => workspace.id === projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)
  if (project.remoteServer) throw new Error('Remote Projects cannot be relinked to a local directory.')
  const currentConfig = inspectWorkspaceStateConfig(project.rootPath)
  if (currentConfig && project.directoryConfigId === currentConfig.id) {
    throw new Error('The current Project directory is still available.')
  }

  const canonicalRoot = canonicalizeProjectRoot(rootPath)
  const inspectedConfig = inspectWorkspaceStateConfig(canonicalRoot)
  if (!inspectedConfig) {
    throw new Error('Select an existing Storyflow Project directory.')
  }
  if (project.directoryConfigId && inspectedConfig.id !== project.directoryConfigId) {
    throw new Error('The selected directory belongs to a different Storyflow Project.')
  }
  if (
    !project.directoryConfigId
    && expectedSessionIds.length === 0
    && !sameRoot(project.rootPath, canonicalRoot)
  ) {
    throw new Error(
      'This Project has no saved relink fingerprint. Restore its previous location or import the selected Project instead.',
    )
  }

  const targetSessionIds = new Set(listSessions(canonicalRoot).map(session => session.id))
  const missingSessionId = expectedSessionIds.find(sessionId => !targetSessionIds.has(sessionId))
  if (missingSessionId) {
    throw new Error(`The selected directory does not contain Session ${missingSessionId}.`)
  }

  const claimed = config.workspaces.find(workspace => (
    workspace.id !== projectId && sameRoot(workspace.rootPath, canonicalRoot)
  ))
  if (claimed) throw new Error(`This directory already belongs to "${claimed.name}".`)
  assertProjectContentIsUnclaimed(canonicalRoot, inspectedConfig.id, projectId)

  return {
    projectId,
    previousRoot: project.rootPath,
    currentRoot: canonicalRoot,
    directoryConfigId: inspectedConfig.id,
    workspace: {
      ...project,
      name: inspectedConfig.name || project.name || basename(canonicalRoot),
      rootPath: canonicalRoot,
      slug: extractWorkspaceSlugFromPath(canonicalRoot, project.id),
      directoryConfigId: inspectedConfig.id,
      rootAvailable: true,
    },
  }
}

/** Commit only the Host-owned locator after runtime state is durable at the target. */
export function commitWorkspaceRootRelink(plan: WorkspaceRootRelinkPlan): Workspace {
  const config = loadStoredConfig()
  if (!config) throw new Error('Config not found')

  const project = config.workspaces.find(workspace => workspace.id === plan.projectId)
  if (!project || project.rootPath !== plan.previousRoot) {
    throw new Error('The Project registration changed while relink was being prepared.')
  }
  const targetConfig = inspectWorkspaceStateConfig(plan.currentRoot)
  if (!targetConfig || targetConfig.id !== plan.directoryConfigId) {
    throw new Error('The selected Project changed while it was being prepared.')
  }
  const claimed = config.workspaces.find(workspace => (
    workspace.id !== plan.projectId && sameRoot(workspace.rootPath, plan.currentRoot)
  ))
  if (claimed) throw new Error(`This directory already belongs to "${claimed.name}".`)
  if (plan.workspace.grantedWorkingDirectoryRoots === undefined) {
    throw new Error('Legacy working-directory grants must be migrated before committing a Project relink.')
  }

  project.rootPath = plan.currentRoot
  project.slug = plan.workspace.slug
  project.name = plan.workspace.name
  project.directoryConfigId = plan.directoryConfigId
  project.grantedWorkingDirectoryRoots = [...plan.workspace.grantedWorkingDirectoryRoots]
  saveConfig(config)

  return { ...project, rootAvailable: true }
}

/** Rebase the directory-owned default cwd after the Host locator has committed. */
export function rebaseWorkspaceDefaultWorkingDirectory(plan: WorkspaceRootRelinkPlan): void {
  const directoryConfig = loadWorkspaceConfig(plan.currentRoot)
  if (!directoryConfig || directoryConfig.id !== plan.directoryConfigId) return
  const rebased = rebasePathWithinProjectRoot(
    directoryConfig.defaults?.workingDirectory,
    plan.previousRoot,
    plan.currentRoot,
  )
  if (rebased === directoryConfig.defaults?.workingDirectory) return
  directoryConfig.defaults = { ...directoryConfig.defaults, workingDirectory: rebased }
  saveWorkspaceConfig(plan.currentRoot, directoryConfig)
}

/** Compatibility wrapper for non-runtime callers. Runtime relink stages Session state first. */
export async function relinkWorkspaceRoot(
  projectId: string,
  rootPath: string,
  expectedSessionIds: readonly string[] = [],
): Promise<Workspace> {
  const plan = prepareWorkspaceRootRelink(projectId, rootPath, expectedSessionIds)
  if (plan.workspace.grantedWorkingDirectoryRoots === undefined) {
    plan.workspace.grantedWorkingDirectoryRoots = await discoverLegacyWorkingDirectoryRoots(
      plan.workspace,
      plan.currentRoot,
    )
  }
  const workspace = commitWorkspaceRootRelink(plan)
  rebaseWorkspaceDefaultWorkingDirectory(plan)
  return workspace
}
