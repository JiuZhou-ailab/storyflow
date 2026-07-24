// input: Current and legacy workspace creation options plus tracked root paths
// output: Remote-only option normalization and stale default root cleanup
// pos: Compatibility boundary between CREATE RPC input and generic workspace storage

import { rmSync } from 'fs'
import { dirname, resolve } from 'path'
import type { RemoteServerConfig } from '@craft-agent/core/types'
import {
  getDefaultWorkspacesDir,
  isValidWorkspace as defaultIsValidWorkspace,
} from '@craft-agent/shared/workspaces'

export interface CreateWorkspaceOptions {
  remoteServer?: RemoteServerConfig
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
  input?: CreateWorkspaceOptions | RemoteServerConfig | Record<string, unknown>,
  _legacyProjectType?: unknown,
): CreateWorkspaceOptions {
  if (isRemoteServerConfig(input)) {
    return { remoteServer: input }
  }

  const remoteServer = input && typeof input === 'object'
    ? (input as { remoteServer?: unknown }).remoteServer
    : undefined
  if (isRemoteServerConfig(remoteServer)) {
    return { remoteServer }
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
