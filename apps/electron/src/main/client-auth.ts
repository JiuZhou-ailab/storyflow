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
  authBrokerUrl?: string
  feishuBrokerAuth?: ClientFeishuBrokerAuthConfig
  gatewayConnectionSlug?: string
  gatewayConnectionSlugs?: string[]
  feishuCallbackPort?: number
  feishuLoginTimeoutMs?: number
}

export interface ClientFeishuBrokerAuthConfig {
  appId: string
  brokerUrl: string
  scope?: string
  authBaseUrl?: string
}

export interface ClientFeishuBrokerPublicConfig {
  enabled: boolean
  appId?: string
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

export interface ClientAuthNeonBrokerExchangeInput {
  brokerUrl: string
  token: string
}

export interface ClientAuthBrokerExchangeResult {
  user: ClientAuthUser
  appSessionToken?: string
  gatewayToken?: string
}

export interface ClientAuthBrokerClient {
  getFeishuAuthConfig?(input: { brokerUrl: string }): Promise<ClientFeishuBrokerPublicConfig | null>
  exchangeNeonToken(input: ClientAuthNeonBrokerExchangeInput): Promise<ClientAuthBrokerExchangeResult>
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
const DEFAULT_GATEWAY_CONNECTION_SLUGS = ['wangsu-default', 'xiaomi-default']
const DEFAULT_FEISHU_CALLBACK_PORT = 6477
const DEFAULT_FEISHU_LOGIN_TIMEOUT_MS = 90_000
const DEFAULT_NEON_BROKER_EXCHANGE_PATH = '/api/client-auth/neon/exchange'
const DEFAULT_FEISHU_BROKER_CONFIG_PATH = '/api/client-auth/feishu/config'
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

  const feishuAppId = readEnv(env.CRAFT_CLIENT_FEISHU_APP_ID)
  const authBrokerUrl = normalizeUrlString(
    readEnv(env.CRAFT_CLIENT_AUTH_BROKER_URL)
      ?? readEnv(env.CRAFT_CLIENT_FEISHU_AUTH_BROKER_URL),
  )
  const feishuBrokerUrl = authBrokerUrl
  const feishuScope = readEnv(env.CRAFT_CLIENT_FEISHU_SCOPE) ?? readEnv(env.CRAFT_WEBUI_FEISHU_SCOPE)
  const feishuAuthBaseUrl = readEnv(env.CRAFT_CLIENT_FEISHU_AUTH_BASE_URL) ?? readEnv(env.CRAFT_WEBUI_FEISHU_AUTH_BASE_URL)
  const feishuCallbackPort = readPortEnv(env.CRAFT_CLIENT_FEISHU_CALLBACK_PORT) ?? DEFAULT_FEISHU_CALLBACK_PORT
  const feishuLoginTimeoutMs = readPositiveIntegerEnv(env.CRAFT_CLIENT_FEISHU_LOGIN_TIMEOUT_MS)
    ?? readPositiveIntegerEnv(env.CRAFT_WEBUI_FEISHU_LOGIN_TIMEOUT_MS)
    ?? DEFAULT_FEISHU_LOGIN_TIMEOUT_MS
  const gatewayConnectionSlugs = readConnectionSlugList(env.CRAFT_CLIENT_GATEWAY_LLM_CONNECTION_SLUG)
    ?? DEFAULT_GATEWAY_CONNECTION_SLUGS

  return {
    required,
    gatewayConnectionSlug: gatewayConnectionSlugs[0] ?? DEFAULT_GATEWAY_CONNECTION_SLUG,
    gatewayConnectionSlugs,
    ...(authBrokerUrl ? { authBrokerUrl } : {}),
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
  const authBrokerClient = config.authBrokerUrl || config.feishuBrokerAuth
    ? (deps.createAuthBrokerClient ?? (() => new DefaultClientAuthBrokerClient()))()
    : null
  const feishuBrokerStateStore = config.feishuBrokerAuth ? new FeishuOAuthStateStore() : null
  const emailPasswordEnabled = neonAuth?.isConfigured() ?? false
  const feishuLoginEnabled = config.feishuBrokerAuth !== undefined && authBrokerClient !== null
  const configured = emailPasswordEnabled || feishuLoginEnabled
  let currentUser: ClientAuthUser | null = null
  let currentGatewayCredentials: Array<{
    connectionSlug: string
    token: string
  }> = []
  let activeFeishuLogin: {
    close: () => void | Promise<void>
    reject: (error: Error) => void
  } | null = null

  async function storeGatewayCredential(token: string | undefined, user: ClientAuthUser): Promise<void> {
    const connectionSlugs = getGatewayConnectionSlugs(config)
    const gatewayToken = readEnv(token)
    if (connectionSlugs.length === 0 || !gatewayToken || !deps.gatewayCredentialStore) return

    const storedCredentials: Array<{ connectionSlug: string, token: string }> = []
    for (const connectionSlug of connectionSlugs) {
      await deps.gatewayCredentialStore.setGatewayToken({
        connectionSlug,
        token: gatewayToken,
        user,
      })
      storedCredentials.push({
        connectionSlug,
        token: gatewayToken,
      })
    }
    currentGatewayCredentials = storedCredentials
  }

  async function clearGatewayCredential(): Promise<void> {
    if (currentGatewayCredentials.length === 0 || !deps.gatewayCredentialStore) {
      currentGatewayCredentials = []
      return
    }

    for (const credential of currentGatewayCredentials) {
      await deps.gatewayCredentialStore.clearGatewayToken(credential)
    }
    currentGatewayCredentials = []
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
      const brokerResult = config.authBrokerUrl && authBrokerClient
        ? await authBrokerClient.exchangeNeonToken({
            brokerUrl: config.authBrokerUrl,
            token: authResult.token,
          })
        : null
      await storeGatewayCredential(brokerResult?.gatewayToken, user)
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
      if (!config.feishuBrokerAuth || !authBrokerClient || !feishuBrokerStateStore) {
        throw new Error('Feishu login is not configured')
      }

      const feishuBrokerAuth = await resolveFeishuBrokerAuthConfig(config.feishuBrokerAuth, authBrokerClient)

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

        const brokerState = feishuBrokerStateStore.create(redirectUri)
        const authUrl = buildFeishuAuthorizeUrl({
          appId: feishuBrokerAuth.appId,
          redirectUri,
          state: brokerState.state,
          codeChallenge: brokerState.codeChallenge,
          scope: feishuBrokerAuth.scope,
          authBaseUrl: feishuBrokerAuth.authBaseUrl,
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

        const brokerResult = await authBrokerClient.exchangeFeishuCode({
          brokerUrl: feishuBrokerAuth.brokerUrl,
          code,
          redirectUri: consumedState.redirectUri,
          codeVerifier: consumedState.codeVerifier,
        })
        const user = normalizeBrokerClientAuthUser(brokerResult.user)
        await storeGatewayCredential(brokerResult.gatewayToken, user)
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
  async getFeishuAuthConfig(input: { brokerUrl: string }): Promise<ClientFeishuBrokerPublicConfig | null> {
    const endpoint = buildBrokerEndpointUrl(input.brokerUrl, DEFAULT_FEISHU_BROKER_CONFIG_PATH)
    const body = await requestBrokerJson(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }, 'Feishu broker config request failed', { allowNotFound: true })

    return body ? normalizeFeishuBrokerPublicConfig(body) : null
  }

  async exchangeNeonToken(input: ClientAuthNeonBrokerExchangeInput): Promise<ClientAuthBrokerExchangeResult> {
    const endpoint = buildBrokerEndpointUrl(input.brokerUrl, DEFAULT_NEON_BROKER_EXCHANGE_PATH)
    const body = await requestBrokerJson(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: 'application/json',
      },
    }, 'Neon broker exchange failed')

    return normalizeBrokerExchangeResult(body, 'neon')
  }

  async exchangeFeishuCode(input: ClientAuthBrokerExchangeInput): Promise<ClientAuthBrokerExchangeResult> {
    const endpoint = buildBrokerEndpointUrl(input.brokerUrl, DEFAULT_FEISHU_BROKER_EXCHANGE_PATH)
    const body = await requestBrokerJson(endpoint, {
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
    }, 'Feishu broker exchange failed')

    return normalizeBrokerExchangeResult(body, 'feishu')
  }
}

async function resolveFeishuBrokerAuthConfig(
  fallback: ClientFeishuBrokerAuthConfig,
  brokerClient: ClientAuthBrokerClient,
): Promise<ClientFeishuBrokerAuthConfig> {
  if (!brokerClient.getFeishuAuthConfig) {
    return fallback
  }

  const brokerConfig = await brokerClient.getFeishuAuthConfig({ brokerUrl: fallback.brokerUrl })
  if (!brokerConfig) {
    return fallback
  }

  if (!brokerConfig.enabled) {
    throw new Error('Feishu login is not configured on the auth broker')
  }

  const appId = readEnv(brokerConfig.appId)
  if (!appId) {
    throw new Error('Feishu auth broker config did not include an app id')
  }

  const scope = readEnv(brokerConfig.scope)
  const authBaseUrl = readEnv(brokerConfig.authBaseUrl)
  return {
    appId,
    brokerUrl: fallback.brokerUrl,
    ...(scope ? { scope } : {}),
    ...(authBaseUrl ? { authBaseUrl } : {}),
  }
}

function normalizeFeishuBrokerPublicConfig(body: Record<string, unknown>): ClientFeishuBrokerPublicConfig {
  const appId = readStringValue(body.appId)
  const scope = readStringValue(body.scope)
  const authBaseUrl = readStringValue(body.authBaseUrl)
  return {
    enabled: body.enabled === true,
    ...(appId ? { appId } : {}),
    ...(scope ? { scope } : {}),
    ...(authBaseUrl ? { authBaseUrl } : {}),
  }
}

function normalizeBrokerExchangeResult(body: Record<string, unknown>, defaultProvider: ClientAuthUser['provider']): ClientAuthBrokerExchangeResult {
  const user = normalizeBrokerClientAuthUser(readObjectValue(body.user), defaultProvider)
  const appSessionToken = readStringValue(body.appSessionToken) ?? readStringValue(body.sessionToken)
  const gatewayToken = readStringValue(body.gatewayToken)

  return {
    user,
    ...(appSessionToken ? { appSessionToken } : {}),
    ...(gatewayToken ? { gatewayToken } : {}),
  }
}

function normalizeBrokerClientAuthUser(value: unknown, defaultProvider: ClientAuthUser['provider'] = 'feishu'): ClientAuthUser {
  const record = readObjectValue(value)
  if (!record) {
    throw new Error('Feishu broker exchange response did not include a user')
  }

  const provider = record.provider === 'neon' || record.provider === 'feishu'
    ? record.provider
    : defaultProvider
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

function getGatewayConnectionSlugs(config: ClientAuthConfig): string[] {
  const plural = normalizeConnectionSlugs(config.gatewayConnectionSlugs ?? [])
  if (plural.length > 0) {
    return plural
  }

  const singular = readEnv(config.gatewayConnectionSlug)
  return singular ? [singular] : []
}

function readEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function readConnectionSlugList(value: string | undefined): string[] | undefined {
  const slugs = normalizeConnectionSlugs(value?.split(',') ?? [])
  return slugs.length > 0 ? slugs : undefined
}

function normalizeConnectionSlugs(values: string[]): string[] {
  const slugs: string[] = []
  for (const value of values) {
    const slug = readEnv(value)
    if (slug && !slugs.includes(slug)) {
      slugs.push(slug)
    }
  }
  return slugs
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

function formatBrokerNetworkError(endpoint: string, error: unknown): string {
  const detail = error instanceof Error && error.message
    ? ` (${error.message})`
    : ''
  return `Auth broker is unreachable at ${endpoint}${detail}. ` +
    'Start the auth broker for local development or set CRAFT_CLIENT_AUTH_BROKER_URL to the deployed auth broker.'
}

function requestBrokerJson(
  endpoint: string,
  init: RequestInit,
  failurePrefix: string,
  options: { allowNotFound: true },
): Promise<Record<string, unknown> | null>
function requestBrokerJson(
  endpoint: string,
  init: RequestInit,
  failurePrefix: string,
  options?: { allowNotFound?: false },
): Promise<Record<string, unknown>>
async function requestBrokerJson(
  endpoint: string,
  init: RequestInit,
  failurePrefix: string,
  options: { allowNotFound?: boolean } = {},
): Promise<Record<string, unknown> | null> {
  let res: Response
  try {
    res = await fetch(endpoint, init)
  } catch (err) {
    throw new Error(formatBrokerNetworkError(endpoint, err))
  }

  if (options.allowNotFound && res.status === 404) {
    return null
  }

  const body = await parseJsonObject(res)
  if (!res.ok) {
    throw new Error(readBrokerError(body) ?? `${failurePrefix}: HTTP ${res.status}`)
  }

  return body
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
