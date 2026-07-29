// input: Current and legacy workspace creation options plus tracked root paths
// output: Remote-only option normalization and stale default root cleanup
// pos: Compatibility boundary between CREATE RPC input and generic workspace storage

import { rmSync } from 'fs'
import { dirname, resolve } from 'path'
import type { RemoteServerConnectionInput } from '@craft-agent/core/types'
import {
  getDefaultWorkspacesDir,
  isValidWorkspace as defaultIsValidWorkspace,
} from '@craft-agent/shared/workspaces'

export interface CreateWorkspaceOptions {
  remoteServer?: RemoteServerConnectionInput
}

export interface StaleDefaultWorkspaceRootDeps {
  defaultWorkspacesDir?: string
  isValidWorkspace?: (rootPath: string) => boolean
  removeWorkspaceRoot?: (rootPath: string) => void
}

function isRemoteServerConfig(value: unknown): value is RemoteServerConnectionInput {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RemoteServerConnectionInput>
  return (
    typeof candidate.url === 'string' &&
    typeof candidate.token === 'string' &&
    typeof candidate.remoteWorkspaceId === 'string'
  )
}

export function normalizeRemoteServerConnectionInput(value: unknown): RemoteServerConnectionInput {
  if (!isRemoteServerConfig(value)) throw new Error('Invalid remote server configuration')

  const url = value.url.trim()
  const token = value.token.trim()
  const remoteWorkspaceId = value.remoteWorkspaceId.trim()
  if (!url || !token || !remoteWorkspaceId) throw new Error('Remote server configuration cannot be blank')

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Remote server URL is invalid')
  }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new Error('Remote server URL must use ws:// or wss://')
  }

  return { url, token, remoteWorkspaceId }
}

export function normalizeCreateWorkspaceOptions(
  input?: CreateWorkspaceOptions | RemoteServerConnectionInput | Record<string, unknown>,
  _legacyProjectType?: unknown,
): CreateWorkspaceOptions {
  if (isRemoteServerConfig(input)) {
    return { remoteServer: normalizeRemoteServerConnectionInput(input) }
  }

  const remoteServer = input && typeof input === 'object'
    ? (input as { remoteServer?: unknown }).remoteServer
    : undefined
  if (remoteServer !== undefined) {
    return { remoteServer: normalizeRemoteServerConnectionInput(remoteServer) }
  }

  return {}
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
