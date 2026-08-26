// input: Current and legacy workspace creation options
// output: Remote-only workspace option normalization
// pos: Compatibility boundary between CREATE RPC input and generic workspace storage

import type { RemoteServerConnectionInput } from '@craft-agent/core/types'

export interface CreateWorkspaceOptions {
  remoteServer?: RemoteServerConnectionInput
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
