// input: Electron auth environment and Neon Auth email/password credentials
// output: Client auth state with company scope, persisted session handoff, token freshness checks, and auth operations
// pos: Main-process auth boundary used by managed model capabilities without gating local workspaces

import {
  buildFeishuAuthorizeUrl,
  FeishuOAuthStateStore,
  NeonAuthService,
  type NeonAuthClientConfig,
  type NeonAuthConfig,
  type NeonAuthIdentity,
} from '@craft-agent/server-core/webui'
import { createCallbackServer, type CallbackServer } from '@craft-agent/shared/auth/callback-server'
import {
  ClientAuthTokenLifecycle,
  isClientModelAccessTokenFresh,
} from './client-auth-token-lifecycle'
import {
  DefaultClientAuthBrokerClient,
  isRejectedAppSession,
  normalizeClientAuthBrokerUrl,
  normalizeBrokerClientAuthUser,
  requireAppSessionToken,
  requireModelAccessToken,
  resolveFeishuBrokerAuthConfig,
} from './client-auth-broker'

export {
  CLIENT_MODEL_ACCESS_TOKEN_REFRESH_SKEW_MS,
  getClientModelAccessTokenExpiryMs,
  isClientModelAccessTokenFresh,
} from './client-auth-token-lifecycle'
export {
  ClientAuthBrokerHttpError,
  DefaultClientAuthBrokerClient,
} from './client-auth-broker'

export interface ClientAuthConfig {
  required: boolean
  neonAuthOrigin?: string
  neonAuth?: NeonAuthConfig
  authBrokerUrl?: string
  feishuBrokerAuth?: ClientFeishuBrokerAuthConfig
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

export interface ClientAuthSignInInput { identifier: string, password: string }

export interface ClientAuthSignUpInput extends ClientAuthSignInInput {
  name?: string
}

export interface ClientAuthEmailOtpInput { email: string, otp: string }

export interface ClientAuthUser {
  provider: 'neon' | 'feishu'
  userId: string
  organizationId?: string
  email?: string
  emailVerified?: boolean
  name?: string
  avatarUrl?: string
}

export interface ClientAuthSession {
  user: ClientAuthUser
  appSessionToken?: string
  modelAccessToken?: string
  neonSessionCookie?: string
}

export type ClientAuthSignUpResult =
  | { status: 'authenticated', user: ClientAuthUser }
  | { status: 'verification-required', user?: ClientAuthUser }

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

export interface ClientAuthBrokerTokenRefreshInput {
  brokerUrl: string
  appSessionToken: string
  providerToken?: string
}

export interface ClientAuthBrokerExchangeResult {
  user: ClientAuthUser
  appSessionToken?: string
  modelAccessToken?: string
}

export interface ClientAuthBrokerTokenRefreshResult { appSessionToken: string, modelAccessToken: string }
export interface ClientAuthBrokerMarketTokenResult { marketPublishToken: string, expiresInSeconds: number }

export interface ClientAuthBrokerClient {
  getFeishuAuthConfig?(input: { brokerUrl: string }): Promise<ClientFeishuBrokerPublicConfig | null>
  exchangeNeonToken(input: ClientAuthNeonBrokerExchangeInput): Promise<ClientAuthBrokerExchangeResult>
  exchangeFeishuCode(input: ClientAuthBrokerExchangeInput): Promise<ClientAuthBrokerExchangeResult>
  refreshModelAccessToken(input: ClientAuthBrokerTokenRefreshInput): Promise<ClientAuthBrokerTokenRefreshResult>
  issueSkillsMarketToken?(input: ClientAuthBrokerTokenRefreshInput): Promise<ClientAuthBrokerMarketTokenResult>
}

export interface ClientAuthState {
  required: boolean
  configured: boolean
  authenticated: boolean
  emailPasswordEnabled: boolean
  emailSignUpEnabled: boolean
  feishuLoginEnabled: boolean
  usernameLoginEnabled?: boolean
  user?: ClientAuthUser
}

export type ClientAuthNeonService = Pick<
  NeonAuthService,
  | 'isConfigured'
  | 'getClientConfig'
  | 'authenticateWithEmailPassword'
  | 'verifyEmailOtp'
  | 'getSessionToken'
  | 'getOrganizationToken'
  | 'verifyToken'
>

export interface ClientAuthChange {
  session: ClientAuthSession | null
  state: ClientAuthState
  modelAccessTokenChanged: boolean
}

export interface ClientAuthServiceDeps {
  createNeonAuthService?: (config: NeonAuthConfig) => ClientAuthNeonService
  createAuthBrokerClient?: () => ClientAuthBrokerClient
  createCallbackServer?: (options: { port: number }) => Promise<CallbackServer>
  openExternal?: (url: string) => Promise<void>
  initialSession?: ClientAuthSession | null
  sessionStore?: ClientAuthSessionStore
  now?: () => number
  /** Runs after a durable auth transition so main can reload or revoke live model runtimes. */
  onAuthChange?: (change: ClientAuthChange) => void | Promise<void>
  scheduleTimeout?: (callback: () => void, delayMs: number) => unknown
  cancelTimeout?: (handle: unknown) => void
}

export interface ClientAuthModelAccessTokenResult { token: string, refreshed: boolean }

export interface ClientAuthService {
  getState(): ClientAuthState
  /** Returns a fresh managed-model token, rotating both broker tokens when needed or forced. */
  ensureModelAccessToken(options?: { force?: boolean }): Promise<ClientAuthModelAccessTokenResult>
  /** Returns an ephemeral Market capability for authenticated reads and publication. The token is never persisted. */
  issueSkillsMarketAccessToken(): Promise<string>
  signIn(input: ClientAuthSignInInput): Promise<ClientAuthUser>
  signUp(input: ClientAuthSignUpInput): Promise<ClientAuthSignUpResult>
  verifyEmailOtp(input: ClientAuthEmailOtpInput): Promise<void>
  signInWithFeishu(): Promise<ClientAuthUser>
  cancelFeishuSignIn(): void
  signOut(): Promise<void>
  dispose(): void
}

export interface ClientAuthSessionStore { save(session: ClientAuthSession): Promise<void>, clear(): Promise<void> }

const DEFAULT_CLIENT_AUTH_ORIGIN = 'http://localhost:9100'
const DEFAULT_FEISHU_CALLBACK_PORT = 6477
const DEFAULT_FEISHU_LOGIN_TIMEOUT_MS = 90_000

type ClientAuthEnv = Partial<Pick<NodeJS.ProcessEnv,
  | 'CRAFT_CLIENT_AUTH_REQUIRED'
  | 'CRAFT_CLIENT_AUTH_BROKER_URL'
  | 'CRAFT_CLIENT_FEISHU_AUTH_BROKER_URL'
  | 'CRAFT_CLIENT_FEISHU_APP_ID'
  | 'CRAFT_CLIENT_FEISHU_SCOPE'
  | 'CRAFT_CLIENT_FEISHU_AUTH_BASE_URL'
  | 'CRAFT_CLIENT_FEISHU_CALLBACK_PORT'
  | 'CRAFT_CLIENT_FEISHU_LOGIN_TIMEOUT_MS'
  | 'CRAFT_CLIENT_NEON_AUTH_BASE_URL'
  | 'CRAFT_CLIENT_NEON_AUTH_JWKS_URL'
  | 'CRAFT_CLIENT_NEON_AUTH_ISSUER'
  | 'CRAFT_CLIENT_NEON_AUTH_AUDIENCE'
  | 'CRAFT_CLIENT_NEON_AUTH_ORGANIZATION_ID'
  | 'CRAFT_CLIENT_NEON_AUTH_USERNAME_EMAIL_DOMAIN'
  | 'CRAFT_CLIENT_NEON_AUTH_SIGN_UP_ENABLED'
  | 'CRAFT_CLIENT_NEON_AUTH_ORIGIN'
>>

const BUNDLED_CLIENT_AUTH_ENV: ClientAuthEnv = {
  CRAFT_CLIENT_AUTH_REQUIRED: process.env.CRAFT_CLIENT_AUTH_REQUIRED,
  CRAFT_CLIENT_AUTH_BROKER_URL: process.env.CRAFT_CLIENT_AUTH_BROKER_URL,
  CRAFT_CLIENT_FEISHU_AUTH_BROKER_URL: process.env.CRAFT_CLIENT_FEISHU_AUTH_BROKER_URL,
  CRAFT_CLIENT_FEISHU_APP_ID: process.env.CRAFT_CLIENT_FEISHU_APP_ID,
  CRAFT_CLIENT_FEISHU_SCOPE: process.env.CRAFT_CLIENT_FEISHU_SCOPE,
  CRAFT_CLIENT_FEISHU_AUTH_BASE_URL: process.env.CRAFT_CLIENT_FEISHU_AUTH_BASE_URL,
  CRAFT_CLIENT_FEISHU_CALLBACK_PORT: process.env.CRAFT_CLIENT_FEISHU_CALLBACK_PORT,
  CRAFT_CLIENT_FEISHU_LOGIN_TIMEOUT_MS: process.env.CRAFT_CLIENT_FEISHU_LOGIN_TIMEOUT_MS,
  CRAFT_CLIENT_NEON_AUTH_BASE_URL: process.env.CRAFT_CLIENT_NEON_AUTH_BASE_URL,
  CRAFT_CLIENT_NEON_AUTH_JWKS_URL: process.env.CRAFT_CLIENT_NEON_AUTH_JWKS_URL,
  CRAFT_CLIENT_NEON_AUTH_ISSUER: process.env.CRAFT_CLIENT_NEON_AUTH_ISSUER,
  CRAFT_CLIENT_NEON_AUTH_AUDIENCE: process.env.CRAFT_CLIENT_NEON_AUTH_AUDIENCE,
  CRAFT_CLIENT_NEON_AUTH_ORGANIZATION_ID: process.env.CRAFT_CLIENT_NEON_AUTH_ORGANIZATION_ID,
  CRAFT_CLIENT_NEON_AUTH_USERNAME_EMAIL_DOMAIN: process.env.CRAFT_CLIENT_NEON_AUTH_USERNAME_EMAIL_DOMAIN,
  CRAFT_CLIENT_NEON_AUTH_SIGN_UP_ENABLED: process.env.CRAFT_CLIENT_NEON_AUTH_SIGN_UP_ENABLED,
  CRAFT_CLIENT_NEON_AUTH_ORIGIN: process.env.CRAFT_CLIENT_NEON_AUTH_ORIGIN,
}

function mergeBundledClientAuthEnv(
  runtimeEnv: NodeJS.ProcessEnv,
  bundledEnv: ClientAuthEnv,
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...runtimeEnv }
  for (const [key, value] of Object.entries(bundledEnv)) {
    if (!readEnv(merged[key])) merged[key] = value
  }
  return merged
}

export function createClientAuthConfigFromEnv(env: NodeJS.ProcessEnv): ClientAuthConfig {
  const required = readBooleanEnv(env.CRAFT_CLIENT_AUTH_REQUIRED) ?? false
  const baseUrl = readEnv(env.CRAFT_CLIENT_NEON_AUTH_BASE_URL) ?? readEnv(env.CRAFT_WEBUI_NEON_AUTH_BASE_URL)
  const jwksUrl = readEnv(env.CRAFT_CLIENT_NEON_AUTH_JWKS_URL) ?? readEnv(env.CRAFT_WEBUI_NEON_AUTH_JWKS_URL)
  const issuer = readEnv(env.CRAFT_CLIENT_NEON_AUTH_ISSUER) ?? readEnv(env.CRAFT_WEBUI_NEON_AUTH_ISSUER)
  const audience = readEnv(env.CRAFT_CLIENT_NEON_AUTH_AUDIENCE) ?? readEnv(env.CRAFT_WEBUI_NEON_AUTH_AUDIENCE)
  const organizationId = readEnv(env.CRAFT_CLIENT_NEON_AUTH_ORGANIZATION_ID)
    ?? readEnv(env.CRAFT_WEBUI_NEON_AUTH_ORGANIZATION_ID)
  const usernameEmailDomain = readEnv(env.CRAFT_CLIENT_NEON_AUTH_USERNAME_EMAIL_DOMAIN)
    ?? readEnv(env.CRAFT_WEBUI_NEON_AUTH_USERNAME_EMAIL_DOMAIN)
  const emailSignUpEnabled = readBooleanEnv(env.CRAFT_CLIENT_NEON_AUTH_SIGN_UP_ENABLED)
    ?? readBooleanEnv(env.CRAFT_WEBUI_NEON_AUTH_SIGN_UP_ENABLED)
    ?? false
  const neonAuthOrigin = readEnv(env.CRAFT_CLIENT_NEON_AUTH_ORIGIN)
    ?? readEnv(env.CRAFT_WEBUI_NEON_AUTH_ORIGIN)
    ?? (baseUrl ? DEFAULT_CLIENT_AUTH_ORIGIN : undefined)

  const feishuAppId = readEnv(env.CRAFT_CLIENT_FEISHU_APP_ID)
  const rawAuthBrokerUrl = readEnv(env.CRAFT_CLIENT_AUTH_BROKER_URL)
    ?? readEnv(env.CRAFT_CLIENT_FEISHU_AUTH_BROKER_URL)
  const authBrokerUrl = rawAuthBrokerUrl
    ? normalizeClientAuthBrokerUrl(rawAuthBrokerUrl)
    : undefined
  const feishuBrokerUrl = authBrokerUrl
  const feishuScope = readEnv(env.CRAFT_CLIENT_FEISHU_SCOPE) ?? readEnv(env.CRAFT_WEBUI_FEISHU_SCOPE)
  const feishuAuthBaseUrl = readEnv(env.CRAFT_CLIENT_FEISHU_AUTH_BASE_URL) ?? readEnv(env.CRAFT_WEBUI_FEISHU_AUTH_BASE_URL)
  const feishuCallbackPort = readPortEnv(env.CRAFT_CLIENT_FEISHU_CALLBACK_PORT) ?? DEFAULT_FEISHU_CALLBACK_PORT
  const feishuLoginTimeoutMs = readPositiveIntegerEnv(env.CRAFT_CLIENT_FEISHU_LOGIN_TIMEOUT_MS)
    ?? readPositiveIntegerEnv(env.CRAFT_WEBUI_FEISHU_LOGIN_TIMEOUT_MS)
    ?? DEFAULT_FEISHU_LOGIN_TIMEOUT_MS

  return {
    required,
    ...(authBrokerUrl ? { authBrokerUrl } : {}),
    ...(neonAuthOrigin ? { neonAuthOrigin } : {}),
    ...(baseUrl
      ? {
          neonAuth: {
            baseUrl,
            ...(jwksUrl ? { jwksUrl } : {}),
            ...(issuer ? { issuer } : {}),
            ...(audience ? { audience } : {}),
            ...(organizationId ? { organizationId } : {}),
            ...(usernameEmailDomain ? { usernameEmailDomain } : {}),
            emailSignUpEnabled,
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

export function createClientAuthConfigFromRuntimeEnv(
  runtimeEnv: NodeJS.ProcessEnv = process.env,
  bundledEnv: ClientAuthEnv = BUNDLED_CLIENT_AUTH_ENV,
): ClientAuthConfig {
  return createClientAuthConfigFromEnv(mergeBundledClientAuthEnv(runtimeEnv, bundledEnv))
}

export function createClientAuthService(
  config: ClientAuthConfig,
  deps: ClientAuthServiceDeps = {},
): ClientAuthService {
  const neonAuth = config.neonAuth
    ? (deps.createNeonAuthService ?? ((neonAuthConfig) => new NeonAuthService(neonAuthConfig)))(config.neonAuth)
    : null
  const authBrokerUrl = config.authBrokerUrl ?? config.feishuBrokerAuth?.brokerUrl
  const authBrokerClient = authBrokerUrl
    ? (deps.createAuthBrokerClient ?? (() => new DefaultClientAuthBrokerClient()))()
    : null
  const feishuBrokerStateStore = config.feishuBrokerAuth ? new FeishuOAuthStateStore() : null
  const emailPasswordEnabled = Boolean(neonAuth?.isConfigured() && authBrokerClient)
  const neonClientConfig = emailPasswordEnabled ? neonAuth?.getClientConfig() : undefined
  const emailSignUpEnabled = neonClientConfig?.emailSignUpEnabled === true
  const feishuLoginEnabled = config.feishuBrokerAuth !== undefined && authBrokerClient !== null
  const configured = emailPasswordEnabled || feishuLoginEnabled
  let currentSession: ClientAuthSession | null = deps.initialSession
    && authBrokerClient
    && readEnv(deps.initialSession.appSessionToken)
    ? deps.initialSession
    : null
  let activeFeishuLogin: {
    close: () => void | Promise<void>
    reject: (error: Error) => void
  } | null = null
  let service: ClientAuthService
  const tokenLifecycle = new ClientAuthTokenLifecycle<ClientAuthModelAccessTokenResult>({
    canRefresh: () => Boolean(currentSession?.appSessionToken && authBrokerClient),
    onScheduledRefresh: () => service.ensureModelAccessToken({ force: true }),
    now: deps.now,
    scheduleTimeout: deps.scheduleTimeout,
    cancelTimeout: deps.cancelTimeout,
  })

  function getState(): ClientAuthState {
    return buildClientAuthState({
      required: config.required,
      configured,
      emailPasswordEnabled,
      emailSignUpEnabled,
      feishuLoginEnabled,
      clientConfig: neonClientConfig,
      user: currentSession?.user ?? null,
    })
  }

  async function saveCurrentSession(session: ClientAuthSession): Promise<void> {
    if (tokenLifecycle.disposed) throw new Error('Client auth service is disposed')
    const generation = tokenLifecycle.beginTransition()
    await tokenLifecycle.runExclusive(async () => {
      tokenLifecycle.assertCurrent(generation)
      const modelAccessTokenChanged = currentSession?.modelAccessToken !== session.modelAccessToken
      await deps.sessionStore?.save(session)
      tokenLifecycle.assertCurrent(generation)
      currentSession = session
      await notifyAuthChange(modelAccessTokenChanged)
    })
    tokenLifecycle.schedule(session.modelAccessToken)
  }

  async function notifyAuthChange(modelAccessTokenChanged: boolean): Promise<void> {
    await deps.onAuthChange?.({
      session: currentSession,
      state: getState(),
      modelAccessTokenChanged,
    })
  }

  async function clearRejectedSession(
    session: ClientAuthSession,
    generation: number,
  ): Promise<void> {
    if (!tokenLifecycle.isCurrent(generation) || currentSession !== session) return
    const invalidationGeneration = tokenLifecycle.beginTransition()
    tokenLifecycle.cancelScheduled()
    await tokenLifecycle.runExclusive(async () => {
      if (!tokenLifecycle.isCurrent(invalidationGeneration)) return
      await deps.sessionStore?.clear()
      if (!tokenLifecycle.isCurrent(invalidationGeneration)) return
      currentSession = null
      await notifyAuthChange(true)
    })
  }

  async function saveNeonSession(
    providerToken: string,
    sessionCookie: string | undefined,
    verifiedUser: ClientAuthUser,
  ): Promise<ClientAuthUser> {
    if (!authBrokerUrl || !authBrokerClient) throw new Error('Client auth broker is not configured')

    const brokerResult = await authBrokerClient.exchangeNeonToken({
      brokerUrl: authBrokerUrl,
      token: providerToken,
    })
    const user = normalizeBrokerClientAuthUser(brokerResult.user, 'neon')
    const modelAccessToken = requireModelAccessToken(brokerResult)
    const appSessionToken = requireAppSessionToken(brokerResult)
    await saveCurrentSession({
      user,
      appSessionToken,
      modelAccessToken,
      ...(sessionCookie ? { neonSessionCookie: sessionCookie } : {}),
    })
    return user
  }

  async function getNeonProviderToken(sessionCookie: string): Promise<string> {
    const organizationId = readEnv(config.neonAuth?.organizationId)
    if (!neonAuth) throw new Error('Neon Auth is not configured')
    if (!organizationId) {
      return neonAuth.getSessionToken({ sessionCookie, origin: config.neonAuthOrigin })
    }
    return neonAuth.getOrganizationToken({
      sessionCookie,
      organizationId,
      origin: config.neonAuthOrigin,
    })
  }

  service = {
    getState,

    ensureModelAccessToken(options = {}): Promise<ClientAuthModelAccessTokenResult> {
      const session = currentSession
      if (!session) return Promise.reject(new Error('Client authentication is required'))
      if (!options.force) {
        const pendingRefresh = tokenLifecycle.getPendingRefresh()
        if (pendingRefresh) return pendingRefresh
        const existingToken = readEnv(session.modelAccessToken)
        if (existingToken && isClientModelAccessTokenFresh(existingToken, tokenLifecycle.nowMs)) {
          return Promise.resolve({ token: existingToken, refreshed: false })
        }
      }

      return tokenLifecycle.runSingleFlight(async () => {
        const session = currentSession
        const generation = tokenLifecycle.generation
        if (!session) throw new Error('Client authentication is required')
        const existingToken = readEnv(session.modelAccessToken)
        if (!options.force && existingToken && isClientModelAccessTokenFresh(existingToken, tokenLifecycle.nowMs)) {
          return { token: existingToken, refreshed: false }
        }
        const appSessionToken = readEnv(session.appSessionToken)
        if (!authBrokerUrl || !authBrokerClient || !appSessionToken) {
          throw new Error('Client auth session cannot refresh model access')
        }
        let refreshed: ClientAuthBrokerTokenRefreshResult
        try {
          const providerToken = session.user.provider === 'neon'
            ? await getNeonProviderToken(requireNeonSessionCookie(session))
            : undefined
          refreshed = await authBrokerClient.refreshModelAccessToken({
            brokerUrl: authBrokerUrl,
            appSessionToken,
            ...(providerToken ? { providerToken } : {}),
          })
        } catch (error) {
          if (isRejectedAppSession(error) || isRejectedNeonSession(error)) {
            await clearRejectedSession(session, generation)
          }
          throw error
        }
        const nextSession = {
          user: session.user,
          appSessionToken: requireAppSessionToken(refreshed),
          modelAccessToken: requireModelAccessToken(refreshed),
          ...(session.neonSessionCookie ? { neonSessionCookie: session.neonSessionCookie } : {}),
        }
        await tokenLifecycle.runExclusive(async () => {
          tokenLifecycle.assertCurrent(generation)
          if (currentSession !== session) throw new Error('Client auth session changed')
          await deps.sessionStore?.save(nextSession)
          tokenLifecycle.assertCurrent(generation)
          currentSession = nextSession
          await notifyAuthChange(true)
        })
        tokenLifecycle.schedule(nextSession.modelAccessToken)
        return { token: nextSession.modelAccessToken, refreshed: true }
      })
    },

    async issueSkillsMarketAccessToken(): Promise<string> {
      const session = currentSession
      const appSessionToken = readEnv(session?.appSessionToken)
      if (!session || !authBrokerUrl || !authBrokerClient?.issueSkillsMarketToken || !appSessionToken) {
        throw new Error('Client authentication is required for company Skills')
      }
      const generation = tokenLifecycle.generation
      try {
        const providerToken = session.user.provider === 'neon'
          ? await getNeonProviderToken(requireNeonSessionCookie(session))
          : undefined
        const result = await authBrokerClient.issueSkillsMarketToken({
          brokerUrl: authBrokerUrl,
          appSessionToken,
          ...(providerToken ? { providerToken } : {}),
        })
        if (!tokenLifecycle.isCurrent(generation) || currentSession !== session) {
          throw new Error('Client auth session changed')
        }
        return result.marketPublishToken
      } catch (error) {
        if (isRejectedAppSession(error) || isRejectedNeonSession(error)) {
          await clearRejectedSession(session, generation)
        }
        throw error
      }
    },

    async signIn(input: ClientAuthSignInInput): Promise<ClientAuthUser> {
      if (!neonAuth || !emailPasswordEnabled) {
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

      const providerToken = authResult.sessionCookie
        ? await getNeonProviderToken(authResult.sessionCookie)
        : authResult.token
      const user = toClientAuthUser(await neonAuth.verifyToken(providerToken))
      return saveNeonSession(providerToken, authResult.sessionCookie, user)
    },

    async signUp(input: ClientAuthSignUpInput): Promise<ClientAuthSignUpResult> {
      if (!neonAuth || !emailPasswordEnabled) {
        throw new Error('Client auth is not configured')
      }
      if (!emailSignUpEnabled) {
        throw new Error('Email sign-up is disabled')
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
        mode: 'sign-up',
        email: identifier,
        password: input.password,
        name: readEnv(input.name),
        origin: config.neonAuthOrigin,
      })

      if (authResult.status === 'verification-required') {
        return {
          status: 'verification-required',
          ...(authResult.user ? { user: toClientAuthUserFromEmailPasswordUser(authResult.user) } : {}),
        }
      }

      const providerToken = authResult.sessionCookie
        ? await getNeonProviderToken(authResult.sessionCookie)
        : authResult.token
      const user = toClientAuthUser(await neonAuth.verifyToken(providerToken))
      if (user.emailVerified !== true) {
        return { status: 'verification-required', user }
      }
      const authenticatedUser = await saveNeonSession(providerToken, authResult.sessionCookie, user)
      return { status: 'authenticated', user: authenticatedUser }
    },

    async verifyEmailOtp(input: ClientAuthEmailOtpInput): Promise<void> {
      if (!neonAuth || !emailPasswordEnabled) throw new Error('Client auth is not configured')
      await neonAuth.verifyEmailOtp({
        email: input.email,
        otp: input.otp,
        origin: config.neonAuthOrigin,
      })
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
        const modelAccessToken = requireModelAccessToken(brokerResult)
        await saveCurrentSession({
          user,
          appSessionToken: requireAppSessionToken(brokerResult),
          modelAccessToken,
        })
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
      const generation = tokenLifecycle.beginTransition()
      tokenLifecycle.cancelScheduled()
      if (activeFeishuLogin) {
        activeFeishuLogin.reject(new Error('Feishu login was cancelled'))
        await activeFeishuLogin.close()
        activeFeishuLogin = null
      }
      await tokenLifecycle.runExclusive(async () => {
        if (!tokenLifecycle.isCurrent(generation)) return
        await deps.sessionStore?.clear()
        if (!tokenLifecycle.isCurrent(generation)) return
        currentSession = null
        await notifyAuthChange(true)
      })
    },

    dispose(): void {
      tokenLifecycle.dispose()
    },
  }

  tokenLifecycle.schedule(currentSession?.modelAccessToken)
  return service
}

function buildClientAuthState(input: {
  required: boolean
  configured: boolean
  emailPasswordEnabled: boolean
  emailSignUpEnabled: boolean
  feishuLoginEnabled: boolean
  clientConfig?: NeonAuthClientConfig
  user: ClientAuthUser | null
}): ClientAuthState {
  return {
    required: input.required,
    configured: input.configured,
    authenticated: input.user !== null,
    emailPasswordEnabled: input.emailPasswordEnabled,
    emailSignUpEnabled: input.emailSignUpEnabled,
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
    ...(identity.organizationId ? { organizationId: identity.organizationId } : {}),
  }
}

function requireNeonSessionCookie(session: ClientAuthSession): string {
  const cookie = readEnv(session.neonSessionCookie)
  if (!cookie) throw new Error('Neon Auth session is required')
  return cookie
}

function isRejectedNeonSession(error: unknown): boolean {
  return error instanceof Error
    && ['Invitation required', 'Neon Auth session is required'].includes(error.message)
}

function toClientAuthUserFromEmailPasswordUser(user: {
  id?: string
  email?: string
  emailVerified?: boolean
  name?: string
}): ClientAuthUser | undefined {
  const userId = readEnv(user.id)
  if (!userId) return undefined

  const email = readEnv(user.email)
  const name = readEnv(user.name)
  return {
    provider: 'neon',
    userId,
    ...(email ? { email: email.toLowerCase() } : {}),
    ...(user.emailVerified !== undefined ? { emailVerified: user.emailVerified } : {}),
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
