// input: Encrypted credential manager entries and model-token freshness policy
// output: Durable client session plus derived managed-model credential projection
// pos: Main-process persistence bridge between client-auth service and shared secure storage

import { getCredentialManager, type CredentialManager } from '@craft-agent/shared/credentials'
import {
  LEGACY_MANAGED_LLM_CONNECTION_SLUG,
  MANAGED_LLM_CONNECTION_SLUGS,
} from '@craft-agent/shared/config'
import type { ClientAuthSession, ClientAuthSessionStore, ClientAuthUser } from './client-auth'
import { isClientModelAccessTokenFresh } from './client-auth-token-lifecycle'

const CLIENT_AUTH_SESSION_ID = { type: 'client_auth_session' as const }
const MANAGED_MODEL_CREDENTIAL_IDS = MANAGED_LLM_CONNECTION_SLUGS.map(connectionSlug => ({
  type: 'llm_api_key' as const,
  connectionSlug,
}))
const LEGACY_MANAGED_MODEL_CREDENTIAL_ID = {
  type: 'llm_api_key' as const,
  connectionSlug: LEGACY_MANAGED_LLM_CONNECTION_SLUG,
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
      if (credential && !session) {
        await clearStoredSession(credentialManager)
        return null
      }
      if (session?.modelAccessToken && !session.appSessionToken) {
        await clearStoredSession(credentialManager)
        return null
      }
      if (session?.modelAccessToken && !isClientModelAccessTokenFresh(session.modelAccessToken)) {
        if (session.appSessionToken) {
          const renewableSession = withoutModelAccessToken(session)
          await credentialManager.set(CLIENT_AUTH_SESSION_ID, {
            value: JSON.stringify(renewableSession),
          })
          await syncModelAccessCredential(credentialManager, undefined)
          return renewableSession
        }
        await clearStoredSession(credentialManager)
        return null
      }
      await syncModelAccessCredential(credentialManager, session?.modelAccessToken)
      return session
    },

    async save(session: ClientAuthSession): Promise<void> {
      if (session.modelAccessToken && !isClientModelAccessTokenFresh(session.modelAccessToken)) {
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
    ...MANAGED_MODEL_CREDENTIAL_IDS.map(id => credentialManager.delete(id)),
    credentialManager.delete(LEGACY_MANAGED_MODEL_CREDENTIAL_ID),
  ])
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failure) throw failure.reason
}

async function syncModelAccessCredential(
  credentialManager: ClientAuthCredentialManager,
  modelAccessToken: string | undefined,
): Promise<void> {
  if (modelAccessToken) {
    await Promise.all(
      MANAGED_MODEL_CREDENTIAL_IDS.map(id =>
        credentialManager.set(id, { value: modelAccessToken })
      ),
    )
    await credentialManager.delete(LEGACY_MANAGED_MODEL_CREDENTIAL_ID)
    return
  }
  const results = await Promise.allSettled([
    ...MANAGED_MODEL_CREDENTIAL_IDS.map(id => credentialManager.delete(id)),
    credentialManager.delete(LEGACY_MANAGED_MODEL_CREDENTIAL_ID),
  ])
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failure) throw failure.reason
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

function withoutModelAccessToken(session: ClientAuthSession): ClientAuthSession {
  return {
    user: session.user,
    ...(session.appSessionToken ? { appSessionToken: session.appSessionToken } : {}),
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
