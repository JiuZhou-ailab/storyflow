// input: Encrypted credential manager entries for desktop client auth
// output: Load/save/clear adapter for persisted desktop auth sessions
// pos: Main-process persistence bridge between client-auth service and shared secure storage

import { getCredentialManager, type CredentialManager } from '@craft-agent/shared/credentials'
import { Buffer } from 'node:buffer'
import type { ClientAuthSession, ClientAuthSessionStore, ClientAuthUser } from './client-auth'

const CLIENT_AUTH_SESSION_ID = { type: 'client_auth_session' as const }
const MANAGED_MODEL_CREDENTIAL_ID = {
  type: 'llm_api_key' as const,
  connectionSlug: 'wangsu-default',
}
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
      const session = credential?.value ? parseClientAuthSession(credential.value) : null
      if (session?.modelAccessToken && !isUnexpiredJwt(session.modelAccessToken)) {
        await clearStoredSession(credentialManager)
        return null
      }
      await syncModelAccessCredential(credentialManager, session?.modelAccessToken)
      return session
    },

    async save(session: ClientAuthSession): Promise<void> {
      if (session.modelAccessToken && !isUnexpiredJwt(session.modelAccessToken)) {
        throw new Error('Model access token is invalid or expired')
      }
      await credentialManager.set(CLIENT_AUTH_SESSION_ID, {
        value: JSON.stringify(session),
      })
      try {
        await syncModelAccessCredential(credentialManager, session.modelAccessToken)
      } catch (error) {
        await clearStoredSession(credentialManager).catch(() => undefined)
        throw error
      }
    },

    async clear(): Promise<void> {
      await clearStoredSession(credentialManager)
    },
  }
}

async function clearStoredSession(credentialManager: ClientAuthCredentialManager): Promise<void> {
  const results = await Promise.allSettled([
    credentialManager.delete(CLIENT_AUTH_SESSION_ID),
    credentialManager.delete(MANAGED_MODEL_CREDENTIAL_ID),
  ])
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failure) throw failure.reason
}

async function syncModelAccessCredential(
  credentialManager: ClientAuthCredentialManager,
  modelAccessToken: string | undefined,
): Promise<void> {
  if (modelAccessToken) {
    await credentialManager.set(MANAGED_MODEL_CREDENTIAL_ID, { value: modelAccessToken })
    return
  }
  await credentialManager.delete(MANAGED_MODEL_CREDENTIAL_ID)
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
  const modelAccessToken = typeof record.modelAccessToken === 'string' && record.modelAccessToken.trim()
    ? record.modelAccessToken.trim()
    : undefined

  return {
    user,
    ...(appSessionToken ? { appSessionToken } : {}),
    ...(modelAccessToken ? { modelAccessToken } : {}),
  }
}

function isUnexpiredJwt(token: string): boolean {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return false
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>
    return typeof payload.exp === 'number' && payload.exp > Date.now() / 1000
  } catch {
    return false
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
