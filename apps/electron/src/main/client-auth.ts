// input: Electron auth environment and Neon Auth email/password credentials
// output: Process-local client auth state and sign-in/sign-out operations
// pos: Main-process auth boundary that gates the desktop renderer before App mounts

import {
  buildFeishuAuthorizeUrl,
  FeishuOAuthStateStore,
  NeonAuthService,
  type NeonAuthClientConfig,
  type NeonAuthConfig,
  type NeonAuthIdentity,
} from '@craft-agent/server-core/webui'
import { createCallbackServer, type CallbackServer } from '@craft-agent/shared/auth/callback-server'

export interface ClientAuthConfig {
  required: boolean
  neonAuthOrigin?: string
  neonAuth?: NeonAuthConfig
  feishuBrokerAuth?: ClientFeishuBrokerAuthConfig
  gatewayConnectionSlug?: string
  feishuCallbackPort?: number
  feishuLoginTimeoutMs?: number
}

export interface ClientFeishuBrokerAuthConfig {
  appId: string
  brokerUrl: string
  scope?: string
  authBaseUrl?: string
}

export interface ClientAuthSignInInput {
  identifier: string
  password: string
}

export interface ClientAuthUser {
  provider: 'neon' | 'feishu'
  userId: string
  email?: string
  emailVerified?: boolean
  name?: string
}

export interface ClientAuthBrokerExchangeInput {
  brokerUrl: string
  code: string
  redirectUri: string
  codeVerifier: string
}

export interface ClientAuthBrokerExchangeResult {
  user: ClientAuthUser
  appSessionToken?: string
  gatewayToken?: string
}

export interface ClientAuthBrokerClient {
  exchangeFeishuCode(input: ClientAuthBrokerExchangeInput): Promise<ClientAuthBrokerExchangeResult>
}

export interface ClientAuthGatewayCredentialStore {
  setGatewayToken(input: {
    connectionSlug: string
    token: string
    user: ClientAuthUser
  }): Promise<void>
  clearGatewayToken(input: {
    connectionSlug: string
    token?: string
  }): Promise<void>
}

export interface ClientAuthState {
  required: boolean
  configured: boolean
  authenticated: boolean
  emailPasswordEnabled: boolean
  feishuLoginEnabled: boolean
  usernameLoginEnabled?: boolean
  user?: ClientAuthUser
}

export type ClientAuthNeonService = Pick<
  NeonAuthService,
  'isConfigured' | 'getClientConfig' | 'authenticateWithEmailPassword' | 'verifyToken'
>

interface ClientAuthServiceDeps {
  createNeonAuthService?: (config: NeonAuthConfig) => ClientAuthNeonService
  createAuthBrokerClient?: () => ClientAuthBrokerClient
  gatewayCredentialStore?: ClientAuthGatewayCredentialStore
  createCallbackServer?: (options: { port: number }) => Promise<CallbackServer>
  openExternal?: (url: string) => Promise<void>
}

export interface ClientAuthService {
  getState(): ClientAuthState
  signIn(input: ClientAuthSignInInput): Promise<ClientAuthUser>
  signInWithFeishu(): Promise<ClientAuthUser>
  cancelFeishuSignIn(): void
  signOut(): Promise<void>
}

const DEFAULT_CLIENT_AUTH_ORIGIN = 'http://localhost:9100'
const DEFAULT_GATEWAY_CONNECTION_SLUG = 'wangsu-default'
const DEFAULT_FEISHU_CALLBACK_PORT = 6477
const DEFAULT_FEISHU_LOGIN_TIMEOUT_MS = 90_000
const DEFAULT_FEISHU_BROKER_EXCHANGE_PATH = '/api/client-auth/feishu/exchange'

export function createClientAuthConfigFromEnv(env: NodeJS.ProcessEnv): ClientAuthConfig {
  const required = readBooleanEnv(env.CRAFT_CLIENT_AUTH_REQUIRED) ?? false
  const baseUrl = readEnv(env.CRAFT_CLIENT_NEON_AUTH_BASE_URL) ?? readEnv(env.CRAFT_WEBUI_NEON_AUTH_BASE_URL)
  const jwksUrl = readEnv(env.CRAFT_CLIENT_NEON_AUTH_JWKS_URL) ?? readEnv(env.CRAFT_WEBUI_NEON_AUTH_JWKS_URL)
  const issuer = readEnv(env.CRAFT_CLIENT_NEON_AUTH_ISSUER) ?? readEnv(env.CRAFT_WEBUI_NEON_AUTH_ISSUER)
  const audience = readEnv(env.CRAFT_CLIENT_NEON_AUTH_AUDIENCE) ?? readEnv(env.CRAFT_WEBUI_NEON_AUTH_AUDIENCE)
  const usernameEmailDomain = readEnv(env.CRAFT_CLIENT_NEON_AUTH_USERNAME_EMAIL_DOMAIN)
    ?? readEnv(env.CRAFT_WEBUI_NEON_AUTH_USERNAME_EMAIL_DOMAIN)
  const neonAuthOrigin = readEnv(env.CRAFT_CLIENT_NEON_AUTH_ORIGIN)
    ?? readEnv(env.CRAFT_WEBUI_NEON_AUTH_ORIGIN)
    ?? (baseUrl ? DEFAULT_CLIENT_AUTH_ORIGIN : undefined)

  const feishuAppId = readEnv(env.CRAFT_CLIENT_FEISHU_APP_ID) ?? readEnv(env.CRAFT_WEBUI_FEISHU_APP_ID)
  const feishuBrokerUrl = normalizeUrlString(
    readEnv(env.CRAFT_CLIENT_AUTH_BROKER_URL)
      ?? readEnv(env.CRAFT_CLIENT_FEISHU_AUTH_BROKER_URL),
  )
  const feishuScope = readEnv(env.CRAFT_CLIENT_FEISHU_SCOPE) ?? readEnv(env.CRAFT_WEBUI_FEISHU_SCOPE)
  const feishuAuthBaseUrl = readEnv(env.CRAFT_CLIENT_FEISHU_AUTH_BASE_URL) ?? readEnv(env.CRAFT_WEBUI_FEISHU_AUTH_BASE_URL)
  const feishuCallbackPort = readPortEnv(env.CRAFT_CLIENT_FEISHU_CALLBACK_PORT) ?? DEFAULT_FEISHU_CALLBACK_PORT
  const feishuLoginTimeoutMs = readPositiveIntegerEnv(env.CRAFT_CLIENT_FEISHU_LOGIN_TIMEOUT_MS)
    ?? readPositiveIntegerEnv(env.CRAFT_WEBUI_FEISHU_LOGIN_TIMEOUT_MS)
    ?? DEFAULT_FEISHU_LOGIN_TIMEOUT_MS
  const gatewayConnectionSlug = readEnv(env.CRAFT_CLIENT_GATEWAY_LLM_CONNECTION_SLUG)
    ?? DEFAULT_GATEWAY_CONNECTION_SLUG

  return {
    required,
    gatewayConnectionSlug,
    ...(neonAuthOrigin ? { neonAuthOrigin } : {}),
    ...(baseUrl
      ? {
          neonAuth: {
            baseUrl,
            ...(jwksUrl ? { jwksUrl } : {}),
            ...(issuer ? { issuer } : {}),
            ...(audience ? { audience } : {}),
            ...(usernameEmailDomain ? { usernameEmailDomain } : {}),
          },
        }
      : {}),
    ...(feishuAppId && feishuBrokerUrl
      ? {
          feishuBrokerAuth: {
            appId: feishuAppId,
            brokerUrl: feishuBrokerUrl,
            ...(feishuScope ? { scope: feishuScope } : {}),
            ...(feishuAuthBaseUrl ? { authBaseUrl: feishuAuthBaseUrl } : {}),
          },
          feishuCallbackPort,
          feishuLoginTimeoutMs,
        }
      : {}),
  }
}

export function createClientAuthService(
  config: ClientAuthConfig,
  deps: ClientAuthServiceDeps = {},
): ClientAuthService {
  const neonAuth = config.neonAuth
    ? (deps.createNeonAuthService ?? ((neonAuthConfig) => new NeonAuthService(neonAuthConfig)))(config.neonAuth)
    : null
  const feishuBrokerClient = config.feishuBrokerAuth
    ? (deps.createAuthBrokerClient ?? (() => new DefaultClientAuthBrokerClient()))()
    : null
  const feishuBrokerStateStore = config.feishuBrokerAuth ? new FeishuOAuthStateStore() : null
  const emailPasswordEnabled = neonAuth?.isConfigured() ?? false
  const feishuLoginEnabled = config.feishuBrokerAuth !== undefined && feishuBrokerClient !== null
  const configured = emailPasswordEnabled || feishuLoginEnabled
  let currentUser: ClientAuthUser | null = null
  let currentGatewayCredential: {
    connectionSlug: string
    token: string
  } | null = null
  let activeFeishuLogin: {
    close: () => void | Promise<void>
    reject: (error: Error) => void
  } | null = null

  async function storeGatewayCredential(token: string | undefined, user: ClientAuthUser): Promise<void> {
    const connectionSlug = readEnv(config.gatewayConnectionSlug)
    const gatewayToken = readEnv(token)
    if (!connectionSlug || !gatewayToken || !deps.gatewayCredentialStore) return

    await deps.gatewayCredentialStore.setGatewayToken({
      connectionSlug,
      token: gatewayToken,
      user,
    })
    currentGatewayCredential = {
      connectionSlug,
      token: gatewayToken,
    }
  }

  async function clearGatewayCredential(): Promise<void> {
    if (!currentGatewayCredential || !deps.gatewayCredentialStore) {
      currentGatewayCredential = null
      return
    }

    await deps.gatewayCredentialStore.clearGatewayToken(currentGatewayCredential)
    currentGatewayCredential = null
  }

  return {
    getState(): ClientAuthState {
      const clientConfig = configured ? neonAuth?.getClientConfig() : undefined
      return buildClientAuthState({
        required: config.required,
        configured,
        emailPasswordEnabled,
        feishuLoginEnabled,
        clientConfig,
        user: currentUser,
      })
    },

    async signIn(input: ClientAuthSignInInput): Promise<ClientAuthUser> {
      if (!neonAuth || !configured) {
        throw new Error('Client auth is not configured')
      }

      const identifier = readEnv(input.identifier)
      if (!identifier) {
        throw new Error(clientConfigRequiresUsername(neonAuth.getClientConfig())
          ? 'Email or username is required'
          : 'Email is required')
      }
      if (!input.password) {
        throw new Error('Password is required')
      }

      const authResult = await neonAuth.authenticateWithEmailPassword({
        mode: 'sign-in',
        email: identifier,
        password: input.password,
        origin: config.neonAuthOrigin,
      })
      if (authResult.status !== 'authenticated') {
        throw new Error('Email verification is required before signing in')
      }

      const user = toClientAuthUser(await neonAuth.verifyToken(authResult.token))
      await storeGatewayCredential(authResult.token, user)
      currentUser = user
      return user
    },

    async signInWithFeishu(): Promise<ClientAuthUser> {
      if (!feishuLoginEnabled) {
        throw new Error('Feishu login is not configured')
      }
      if (activeFeishuLogin) {
        throw new Error('Feishu login is already in progress')
      }

      const createServer = deps.createCallbackServer
        ?? ((options) => createCallbackServer({
          appType: 'electron',
          port: options.port,
          callbackPaths: ['/callback'],
        }))
      const openExternal = deps.openExternal
        ?? (async () => {
          throw new Error('External browser opener is not available')
        })

      const callbackServer = await createServer({
        port: config.feishuCallbackPort ?? DEFAULT_FEISHU_CALLBACK_PORT,
      })

      try {
        const cancelPromise = new Promise<never>((_, reject) => {
          activeFeishuLogin = {
            close: callbackServer.close,
            reject,
          }
        })
        const redirectUri = `${callbackServer.url}/callback`
        if (!config.feishuBrokerAuth || !feishuBrokerClient || !feishuBrokerStateStore) {
          throw new Error('Feishu login is not configured')
        }

        const brokerState = feishuBrokerStateStore.create(redirectUri)
        const authUrl = buildFeishuAuthorizeUrl({
          appId: config.feishuBrokerAuth.appId,
          redirectUri,
          state: brokerState.state,
          codeChallenge: brokerState.codeChallenge,
          scope: config.feishuBrokerAuth.scope,
          authBaseUrl: config.feishuBrokerAuth.authBaseUrl,
        })
        await openExternal(authUrl)
        const callback = await withTimeout(
          Promise.race([callbackServer.promise, cancelPromise]),
          config.feishuLoginTimeoutMs ?? DEFAULT_FEISHU_LOGIN_TIMEOUT_MS,
          () => createFeishuLoginTimeoutError(redirectUri),
        )

        if (callback.query.error) {
          throw new Error(callback.query.error_description || callback.query.error)
        }

        const code = callback.query.code
        const state = callback.query.state
        if (!code || !state) {
          throw new Error('Missing code or state parameter')
        }

        const consumedState = feishuBrokerStateStore.consume(state)
        if (!consumedState) {
          throw new Error('Invalid or expired Feishu OAuth state')
        }

        const brokerResult = await feishuBrokerClient.exchangeFeishuCode({
          brokerUrl: config.feishuBrokerAuth.brokerUrl,
          code,
          redirectUri: consumedState.redirectUri,
          codeVerifier: consumedState.codeVerifier,
        })
        const user = normalizeBrokerClientAuthUser(brokerResult.user)
        await storeGatewayCredential(brokerResult.gatewayToken ?? brokerResult.appSessionToken, user)
        currentUser = user
        return user
      } finally {
        activeFeishuLogin = null
        await callbackServer.close()
      }
    },

    cancelFeishuSignIn(): void {
      if (!activeFeishuLogin) return

      activeFeishuLogin.reject(new Error('Feishu login was cancelled'))
      void activeFeishuLogin.close()
      activeFeishuLogin = null
    },

    async signOut(): Promise<void> {
      if (activeFeishuLogin) {
        activeFeishuLogin.reject(new Error('Feishu login was cancelled'))
        await activeFeishuLogin.close()
        activeFeishuLogin = null
      }
      await clearGatewayCredential()
      currentUser = null
    },
  }
}

function buildClientAuthState(input: {
  required: boolean
  configured: boolean
  emailPasswordEnabled: boolean
  feishuLoginEnabled: boolean
  clientConfig?: NeonAuthClientConfig
  user: ClientAuthUser | null
}): ClientAuthState {
  const authenticated = input.required ? input.user !== null : true

  return {
    required: input.required,
    configured: input.configured,
    authenticated,
    emailPasswordEnabled: input.emailPasswordEnabled,
    feishuLoginEnabled: input.feishuLoginEnabled,
    ...(input.clientConfig?.usernameLoginEnabled ? { usernameLoginEnabled: true } : {}),
    ...(input.user ? { user: input.user } : {}),
  }
}

function toClientAuthUser(identity: NeonAuthIdentity): ClientAuthUser {
  return {
    provider: identity.provider,
    userId: identity.userId,
    ...(identity.email ? { email: identity.email } : {}),
    ...(identity.emailVerified !== undefined ? { emailVerified: identity.emailVerified } : {}),
    ...(identity.name ? { name: identity.name } : {}),
  }
}

export class DefaultClientAuthBrokerClient implements ClientAuthBrokerClient {
  async exchangeFeishuCode(input: ClientAuthBrokerExchangeInput): Promise<ClientAuthBrokerExchangeResult> {
    const res = await fetch(buildBrokerEndpointUrl(input.brokerUrl, DEFAULT_FEISHU_BROKER_EXCHANGE_PATH), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        code: input.code,
        redirectUri: input.redirectUri,
        codeVerifier: input.codeVerifier,
      }),
    })
    const body = await parseJsonObject(res)

    if (!res.ok) {
      throw new Error(readBrokerError(body) ?? `Feishu broker exchange failed: HTTP ${res.status}`)
    }

    return normalizeBrokerExchangeResult(body)
  }
}

function normalizeBrokerExchangeResult(body: Record<string, unknown>): ClientAuthBrokerExchangeResult {
  const user = normalizeBrokerClientAuthUser(readObjectValue(body.user))
  const appSessionToken = readStringValue(body.appSessionToken) ?? readStringValue(body.sessionToken)
  const gatewayToken = readStringValue(body.gatewayToken)

  return {
    user,
    ...(appSessionToken ? { appSessionToken } : {}),
    ...(gatewayToken ? { gatewayToken } : {}),
  }
}

function normalizeBrokerClientAuthUser(value: unknown): ClientAuthUser {
  const record = readObjectValue(value)
  if (!record) {
    throw new Error('Feishu broker exchange response did not include a user')
  }

  const provider = record.provider === 'neon' || record.provider === 'feishu'
    ? record.provider
    : 'feishu'
  const userId = readStringValue(record.userId)
    ?? readStringValue(record.openId)
    ?? readStringValue(record.id)
  if (!userId) {
    throw new Error('Feishu broker exchange response did not include a user id')
  }

  const email = readEnv(readStringValue(record.email))
  const name = readEnv(readStringValue(record.name))
  const emailVerified = typeof record.emailVerified === 'boolean' ? record.emailVerified : undefined

  return {
    provider,
    userId,
    ...(email ? { email: email.toLowerCase() } : {}),
    ...(emailVerified !== undefined ? { emailVerified } : {}),
    ...(name ? { name } : {}),
  }
}

function clientConfigRequiresUsername(config: NeonAuthClientConfig): boolean {
  return config.usernameLoginEnabled === true
}

function readEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function readBooleanEnv(value: string | undefined): boolean | undefined {
  const normalized = readEnv(value)?.toLowerCase()
  if (!normalized) return undefined
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  throw new Error(`Invalid boolean env value: ${value}`)
}

function readPortEnv(value: string | undefined): number | undefined {
  const trimmed = readEnv(value)
  if (!trimmed) return undefined

  const port = Number(trimmed)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port env value: ${value}`)
  }
  return port
}

function readPositiveIntegerEnv(value: string | undefined): number | undefined {
  const trimmed = readEnv(value)
  if (!trimmed) return undefined

  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer env value: ${value}`)
  }
  return parsed
}

function normalizeUrlString(value: string | undefined): string | undefined {
  const trimmed = readEnv(value)
  if (!trimmed) return undefined

  return new URL(trimmed).toString().replace(/\/+$/, '')
}

function buildBrokerEndpointUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return new URL(path.replace(/^\/+/, ''), normalizedBase).toString()
}

async function parseJsonObject(res: Response): Promise<Record<string, unknown>> {
  try {
    const body = await res.json()
    return readObjectValue(body) ?? {}
  } catch {
    return {}
  }
}

function readBrokerError(body: Record<string, unknown>): string | undefined {
  const error = readObjectValue(body.error)
  return readStringValue(error?.message)
    ?? readStringValue(body.message)
    ?? readStringValue(body.error)
}

function readObjectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function readStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  createError: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(createError()), timeoutMs)
  })

  return Promise.race([promise, timeout])
    .finally(() => {
      if (timer) clearTimeout(timer)
    })
}

function createFeishuLoginTimeoutError(redirectUri: string): Error {
  return new Error(
    `Feishu login timed out. Check that the Feishu Open Platform redirect URL exactly matches ${redirectUri}, then try again.`,
  )
}
