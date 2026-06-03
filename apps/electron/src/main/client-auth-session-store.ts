// input: Encrypted credential manager entries for desktop client auth
// output: Load/save/clear adapter for persisted desktop auth sessions
// pos: Main-process persistence bridge between client-auth service and shared secure storage

import { getCredentialManager, type CredentialManager } from '@craft-agent/shared/credentials'
import type { ClientAuthSession, ClientAuthSessionStore, ClientAuthUser } from './client-auth'

const CLIENT_AUTH_SESSION_ID = { type: 'client_auth_session' as const }
type ClientAuthCredentialManager = Pick<CredentialManager, 'get' | 'set' | 'delete'>

export interface PersistentClientAuthSessionStore extends ClientAuthSessionStore {
  load(): Promise<ClientAuthSession | null>
}

export function createClientAuthSessionStore(
  credentialManager: ClientAuthCredentialManager = getCredentialManager(),
): PersistentClientAuthSessionStore {
  return {
    async load(): Promise<ClientAuthSession | null> {
      const credential = await credentialManager.get(CLIENT_AUTH_SESSION_ID)
      if (!credential?.value) return null
      return parseClientAuthSession(credential.value)
    },

    async save(session: ClientAuthSession): Promise<void> {
      await credentialManager.set(CLIENT_AUTH_SESSION_ID, {
        value: JSON.stringify(session),
      })
    },

    async clear(): Promise<void> {
      await credentialManager.delete(CLIENT_AUTH_SESSION_ID)
    },
  }
}

function parseClientAuthSession(value: string): ClientAuthSession | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }

  const record = parsed as Record<string, unknown>
  const user = parseClientAuthUser(record.user)
  if (!user) return null

  const appSessionToken = typeof record.appSessionToken === 'string' && record.appSessionToken.trim()
    ? record.appSessionToken.trim()
    : undefined

  return {
    user,
    ...(appSessionToken ? { appSessionToken } : {}),
  }
}

function parseClientAuthUser(value: unknown): ClientAuthUser | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const provider = record.provider === 'neon' || record.provider === 'feishu'
    ? record.provider
    : null
  const userId = typeof record.userId === 'string' && record.userId.trim()
    ? record.userId.trim()
    : null

  if (!provider || !userId) return null

  const email = typeof record.email === 'string' && record.email.trim()
    ? record.email.trim().toLowerCase()
    : undefined
  const emailVerified = typeof record.emailVerified === 'boolean'
    ? record.emailVerified
    : undefined
  const name = typeof record.name === 'string' && record.name.trim()
    ? record.name.trim()
    : undefined

  return {
    provider,
    userId,
    ...(email ? { email } : {}),
    ...(emailVerified !== undefined ? { emailVerified } : {}),
    ...(name ? { name } : {}),
  }
}
