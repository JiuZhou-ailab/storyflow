import { rmSync } from 'fs'
import { dirname, resolve } from 'path'
import type { RemoteServerConfig } from '@craft-agent/core/types'
import {
  createNovelWorkspaceAtPath as defaultCreateNovelWorkspaceAtPath,
  getDefaultWorkspacesDir,
  isValidWorkspace as defaultIsValidWorkspace,
} from '@craft-agent/shared/workspaces'
import { getBuiltInMethodPack, type MethodPackId } from '@craft-agent/shared/writing/method-packs'

export type WorkspaceProjectType = 'general' | 'novel' | 'short-form'

export interface CreateWorkspaceOptions {
  remoteServer?: RemoteServerConfig
  projectType?: WorkspaceProjectType
  methodPackId?: MethodPackId
}

export interface WorkspaceRootProjectDeps {
  isValidWorkspace: (rootPath: string) => boolean
  createNovelWorkspaceAtPath: (rootPath: string, name: string, methodPackId?: MethodPackId) => void
}

export interface StaleDefaultWorkspaceRootDeps {
  defaultWorkspacesDir?: string
  isValidWorkspace?: (rootPath: string) => boolean
  removeWorkspaceRoot?: (rootPath: string) => void
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
    if (options.methodPackId) return options
    if (options.projectType === 'short-form') {
      return {
        ...options,
        methodPackId: 'short-form.article',
      }
    }
    if (options.projectType !== 'novel') return options
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

function isDefaultWorkspaceChild(rootPath: string, defaultWorkspacesDir: string): boolean {
  const normalizedRootPath = resolve(rootPath)
  const normalizedDefaultDir = resolve(defaultWorkspacesDir)
  return normalizedRootPath !== normalizedDefaultDir && dirname(normalizedRootPath) === normalizedDefaultDir
}

export function resetStaleDefaultWorkspaceRoot(
  rootPath: string,
  trackedRootPaths: string[],
  deps: StaleDefaultWorkspaceRootDeps = {},
): boolean {
  const defaultWorkspacesDir = deps.defaultWorkspacesDir ?? getDefaultWorkspacesDir()
  if (!isDefaultWorkspaceChild(rootPath, defaultWorkspacesDir)) return false

  const normalizedRootPath = resolve(rootPath)
  const isTracked = trackedRootPaths.some((trackedRootPath) => resolve(trackedRootPath) === normalizedRootPath)
  if (isTracked) return false

  const isValidWorkspace = deps.isValidWorkspace ?? defaultIsValidWorkspace
  if (!isValidWorkspace(rootPath)) return false

  const removeWorkspaceRoot = deps.removeWorkspaceRoot ?? ((path: string) => {
    rmSync(path, { recursive: true, force: true })
  })
  removeWorkspaceRoot(rootPath)
  return true
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
  const methodPackId = options.methodPackId
    ?? (options.projectType === 'novel' ? 'novel.claude-book' : undefined)
    ?? (options.projectType === 'short-form' ? 'short-form.article' : undefined)
  if (!methodPackId) return

  const methodPack = getBuiltInMethodPack(methodPackId)
  if (!methodPack) {
    throw new Error(`Unknown method pack: ${methodPackId}`)
  }
  if (deps.isValidWorkspace(rootPath)) return

  deps.createNovelWorkspaceAtPath(rootPath, name, methodPack.id)
}
