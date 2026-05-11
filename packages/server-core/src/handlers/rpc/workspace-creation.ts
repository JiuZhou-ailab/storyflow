import type { RemoteServerConfig } from '@craft-agent/core/types'
import {
  createNovelWorkspaceAtPath as defaultCreateNovelWorkspaceAtPath,
  isValidWorkspace as defaultIsValidWorkspace,
} from '@craft-agent/shared/workspaces'
import { getBuiltInMethodPack, type MethodPackId } from '@craft-agent/shared/writing/method-packs'

export type WorkspaceProjectType = 'general' | 'novel'

export interface CreateWorkspaceOptions {
  remoteServer?: RemoteServerConfig
  projectType?: WorkspaceProjectType
  methodPackId?: MethodPackId
}

export interface WorkspaceRootProjectDeps {
  isValidWorkspace: (rootPath: string) => boolean
  createNovelWorkspaceAtPath: (rootPath: string, name: string, methodPackId?: MethodPackId) => void
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
  const withDefaultMethodPack = (options: CreateWorkspaceOptions): CreateWorkspaceOptions => {
    if (options.methodPackId || options.projectType !== 'novel') return options
    return {
      ...options,
      methodPackId: 'novel.claude-book',
    }
  }

  if (!input) {
    return withDefaultMethodPack(projectType ? { projectType } : {})
  }

  if (isRemoteServerConfig(input)) {
    return withDefaultMethodPack({
      remoteServer: input,
      ...(projectType && { projectType }),
    })
  }

  return withDefaultMethodPack(input)
}

export function ensureWorkspaceRootForProject(
  rootPath: string,
  name: string,
  options: CreateWorkspaceOptions,
  deps: WorkspaceRootProjectDeps = {
    isValidWorkspace: defaultIsValidWorkspace,
    createNovelWorkspaceAtPath: (rootPath, workspaceName, methodPackId) =>
      defaultCreateNovelWorkspaceAtPath(rootPath, workspaceName, undefined, methodPackId),
  },
): void {
  const methodPackId = options.methodPackId ?? (options.projectType === 'novel' ? 'novel.claude-book' : undefined)
  if (!methodPackId) return

  const methodPack = getBuiltInMethodPack(methodPackId)
  if (!methodPack) {
    throw new Error(`Unknown method pack: ${methodPackId}`)
  }
  if (methodPack.projectType !== 'novel') return
  if (deps.isValidWorkspace(rootPath)) return

  deps.createNovelWorkspaceAtPath(rootPath, name, methodPack.id)
}
