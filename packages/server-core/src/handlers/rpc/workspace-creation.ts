import type { RemoteServerConfig } from '@craft-agent/core/types'
import {
  createNovelWorkspaceAtPath as defaultCreateNovelWorkspaceAtPath,
  isValidWorkspace as defaultIsValidWorkspace,
} from '@craft-agent/shared/workspaces'

export type WorkspaceProjectType = 'general' | 'novel'

export interface CreateWorkspaceOptions {
  remoteServer?: RemoteServerConfig
  projectType?: WorkspaceProjectType
}

export interface WorkspaceRootProjectDeps {
  isValidWorkspace: (rootPath: string) => boolean
  createNovelWorkspaceAtPath: (rootPath: string, name: string) => void
}

function isRemoteServerConfig(value: unknown): value is RemoteServerConfig {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RemoteServerConfig>
  return (
    typeof candidate.url === 'string' &&
    typeof candidate.token === 'string' &&
    typeof candidate.remoteWorkspaceId === 'string'
  )
}

export function normalizeCreateWorkspaceOptions(
  input?: CreateWorkspaceOptions | RemoteServerConfig,
  projectType?: WorkspaceProjectType,
): CreateWorkspaceOptions {
  if (!input) {
    return projectType ? { projectType } : {}
  }

  if (isRemoteServerConfig(input)) {
    return {
      remoteServer: input,
      ...(projectType && { projectType }),
    }
  }

  return input
}

export function ensureWorkspaceRootForProject(
  rootPath: string,
  name: string,
  projectType: WorkspaceProjectType | undefined,
  deps: WorkspaceRootProjectDeps = {
    isValidWorkspace: defaultIsValidWorkspace,
    createNovelWorkspaceAtPath: defaultCreateNovelWorkspaceAtPath,
  },
): void {
  if (projectType !== 'novel') return
  if (deps.isValidWorkspace(rootPath)) return

  deps.createNovelWorkspaceAtPath(rootPath, name)
}
