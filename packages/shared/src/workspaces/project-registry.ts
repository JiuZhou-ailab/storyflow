// input: Host Project registrations, selected local roots, and project-owned Session metadata
// output: Canonical local Project registration, compatibility identity restoration, availability, and explicit root relinking
// pos: Product Host boundary that keeps stable Project identity separate from its filesystem locator

import { existsSync, realpathSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import type { Workspace } from '@craft-agent/core/types'
import {
  addWorkspace,
  getWorkspaces,
  loadStoredConfig,
  saveConfig,
} from '../config/storage.ts'
import { listSessions } from '../sessions/storage.ts'
import { normalizePathForComparison } from '../utils/paths.ts'
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
  try {
    if (!statSync(absolute).isDirectory()) {
      throw new Error(`Not a directory: ${absolute}`)
    }
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return absolute
    throw error
  }
  return realpathSync(absolute)
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

/** Pin a pre-fingerprint Project to its already trusted locator without inspecting Session content. */
export function restoreLegacyLocalProjectDirectoryIdentity(projectId: string): Workspace {
  const config = loadStoredConfig()
  const project = config?.workspaces.find(workspace => workspace.id === projectId)
  if (!config || !project) throw new Error(`Project not found: ${projectId}`)
  if (project.remoteServer) throw new Error('Remote Projects do not have local directory identity.')
  if (project.directoryConfigId) throw new Error(`Project ${projectId} already has directory identity.`)

  const canonicalRoot = canonicalizeProjectRoot(project.rootPath)
  const inspectedConfig = inspectWorkspaceConfig(canonicalRoot)
  if (!inspectedConfig) throw new Error(`Failed to verify Storyflow Project: ${canonicalRoot}`)
  assertProjectDirectoryIsUnclaimed(inspectedConfig.id, project.id)

  const directoryConfig = loadWorkspaceConfig(canonicalRoot)
  if (!directoryConfig || directoryConfig.id !== inspectedConfig.id) {
    throw new Error(`Failed to verify Storyflow Project: ${canonicalRoot}`)
  }

  const currentConfig = loadStoredConfig()
  const currentProject = currentConfig?.workspaces.find(workspace => workspace.id === projectId)
  if (
    !currentConfig
    || !currentProject
    || currentProject.remoteServer
    || currentProject.directoryConfigId
    || !sameRoot(currentProject.rootPath, canonicalRoot)
  ) {
    throw new Error('The Project registration changed while the directory was being verified.')
  }
  assertProjectDirectoryIsUnclaimed(directoryConfig.id, currentProject.id)
  currentProject.directoryConfigId = directoryConfig.id
  saveConfig(currentConfig)
  return { ...currentProject, rootAvailable: true }
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

  project.rootPath = plan.currentRoot
  project.slug = plan.workspace.slug
  project.name = plan.workspace.name
  project.directoryConfigId = plan.directoryConfigId
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
export function relinkWorkspaceRoot(
  projectId: string,
  rootPath: string,
  expectedSessionIds: readonly string[] = [],
): Workspace {
  const plan = prepareWorkspaceRootRelink(projectId, rootPath, expectedSessionIds)
  const workspace = commitWorkspaceRootRelink(plan)
  rebaseWorkspaceDefaultWorkingDirectory(plan)
  return workspace
}
