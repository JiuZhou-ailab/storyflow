// input: Desktop client-auth exchange requests and Feishu/Neon identity provider responses
// output: Public auth config, verified desktop identity with company scope, renewable client session, and scoped short-lived capability JWTs
// pos: HTTPS auth broker for packaged desktop login without shipping server secrets
import { createRemoteJWKSet, customFetch, decodeProtectedHeader, jwtVerify, SignJWT, type JWTPayload } from 'jose'

export interface Env {
  CRAFT_WEBUI_FEISHU_APP_ID?: string
  CRAFT_WEBUI_FEISHU_APP_SECRET?: string
  CRAFT_WEBUI_FEISHU_SCOPE?: string
  CRAFT_WEBUI_FEISHU_AUTH_BASE_URL?: string
  CRAFT_WEBUI_FEISHU_API_BASE_URL?: string
  CRAFT_WEBUI_FEISHU_INTERNAL_TENANT_KEYS?: string
  CRAFT_WEBUI_FEISHU_ALLOW_ALL_USERS?: string
  CRAFT_WEBUI_NEON_AUTH_BASE_URL?: string
  CRAFT_WEBUI_NEON_AUTH_JWKS_URL?: string
  CRAFT_WEBUI_NEON_AUTH_ISSUER?: string
  CRAFT_WEBUI_NEON_AUTH_AUDIENCE?: string
  CRAFT_WEBUI_NEON_AUTH_USERNAME_EMAIL_DOMAIN?: string
  STORYFLOW_CLIENT_SESSION_JWT_CURRENT_KEY_ID?: string
  STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET?: string
  STORYFLOW_CLIENT_SESSION_JWT_PREVIOUS_KEY_ID?: string
  STORYFLOW_CLIENT_SESSION_JWT_PREVIOUS_SECRET?: string
  STORYFLOW_GATEWAY_JWT_CURRENT_KEY_ID?: string
  STORYFLOW_GATEWAY_JWT_CURRENT_SECRET?: string
  STORYFLOW_GATEWAY_JWT_PREVIOUS_KEY_ID?: string
  STORYFLOW_GATEWAY_JWT_PREVIOUS_SECRET?: string
  STORYFLOW_GATEWAY_JWT_AUDIENCE?: string
  STORYFLOW_GATEWAY_JWT_ISSUER?: string
  STORYFLOW_SKILLS_MARKET_JWT_CURRENT_KEY_ID?: string
  STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET?: string
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface FeishuUserInfo {
  openId: string
  tenantKey?: string
  email?: string
  enterpriseEmail?: string
  name?: string
  avatarUrl?: string
}

interface NeonIdentity {
  provider: 'feishu' | 'neon'
  subject: string
  userId: string
  email?: string
  emailVerified?: boolean
  name?: string
}

interface ClientSessionPayload extends JWTPayload {
  scope?: unknown
  model_tier?: unknown
  auth_time?: unknown
  user_name?: unknown
  organization_id?: unknown
}

const DEFAULT_FEISHU_AUTH_BASE_URL = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize'
const DEFAULT_FEISHU_API_BASE_URL = 'https://open.feishu.cn'
const DEFAULT_GATEWAY_AUDIENCE = 'storyflow-model-gateway'
const DEFAULT_GATEWAY_ISSUER = 'storyflow-auth-broker'
const DEFAULT_CLIENT_SESSION_AUDIENCE = 'storyflow-client-auth'
const DEFAULT_SKILLS_MARKET_AUDIENCE = 'storyflow-skills-market'
const STORYFLOW_ORGANIZATION_ID = 'storyflow'
const DEFAULT_CURRENT_KEY_ID = 'current'
const CLIENT_SESSION_TOKEN_TTL_SECONDS = 2_592_000
const MODEL_ACCESS_TOKEN_TTL_SECONDS = 900
const SKILLS_MARKET_TOKEN_TTL_SECONDS = 300

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env, fetch)
  },
}

export async function handleRequest(
  request: Request,
  env: Env,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname === '/health') {
    return Response.json({ status: 'ok' })
  }

  if (url.pathname === '/ready') {
    if (request.method !== 'GET') {
      return Response.json(
        { error: 'Method not allowed' },
        { status: 405, headers: { Allow: 'GET' } },
      )
    }
    return getBrokerReadinessError(env)
      ? Response.json(
          { status: 'not_ready', code: 'configuration_invalid' },
          { status: 503 },
        )
      : Response.json({ status: 'ready' })
  }

  if (url.pathname === '/api/client-auth/feishu/config' && request.method === 'GET') {
    const appId = readString(env.CRAFT_WEBUI_FEISHU_APP_ID)
    const appSecret = readString(env.CRAFT_WEBUI_FEISHU_APP_SECRET)
    if (!appId || !appSecret) {
      return Response.json({ enabled: false })
    }

    const scope = readString(env.CRAFT_WEBUI_FEISHU_SCOPE)
    const authBaseUrl = readString(env.CRAFT_WEBUI_FEISHU_AUTH_BASE_URL)
    return Response.json({
      enabled: true,
      appId,
      ...(scope ? { scope } : {}),
      ...(authBaseUrl ? { authBaseUrl } : {}),
    })
  }

  if (url.pathname === '/api/client-auth/feishu/exchange' && request.method === 'POST') {
    return exchangeFeishuCode(request, env, fetchImpl)
  }

  if (url.pathname === '/api/client-auth/neon/exchange' && request.method === 'POST') {
    return exchangeNeonToken(request, env, fetchImpl)
  }

  if (url.pathname === '/api/client-auth/token' && request.method === 'POST') {
    return refreshClientAuthToken(request, env)
  }

  if (url.pathname === '/api/client-auth/skills-market/token' && request.method === 'POST') {
    return issueSkillsMarketToken(request, env)
  }

  return Response.json({ error: 'Not found' }, { status: 404 })
}

async function exchangeFeishuCode(
  request: Request,
  env: Env,
  fetchImpl: FetchLike,
): Promise<Response> {
  const appId = readString(env.CRAFT_WEBUI_FEISHU_APP_ID)
  const appSecret = readString(env.CRAFT_WEBUI_FEISHU_APP_SECRET)
  if (!appId || !appSecret) {
    return Response.json({ error: 'Feishu login is not configured' }, { status: 404 })
  }

  const body = await readJsonObject(request)
  const code = readString(body.code)
  const redirectUri = readString(body.redirectUri)
  const codeVerifier = readString(body.codeVerifier)
  if (!code) return Response.json({ error: 'Feishu authorization code is required' }, { status: 400 })
  if (!redirectUri || !isLoopbackRedirectUri(redirectUri)) {
    return Response.json({ error: 'Feishu redirect URI must be a loopback callback' }, { status: 400 })
  }
  if (!codeVerifier) return Response.json({ error: 'Feishu PKCE code verifier is required' }, { status: 400 })
  const tokenConfigError = getTokenIssuanceConfigError(env)
  if (tokenConfigError) return Response.json({ error: tokenConfigError }, { status: 503 })

  try {
    const apiBaseUrl = readString(env.CRAFT_WEBUI_FEISHU_API_BASE_URL) ?? DEFAULT_FEISHU_API_BASE_URL
    const tokenRes = await fetchImpl(`${apiBaseUrl}/open-apis/authen/v2/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: appId,
        client_secret: appSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    })
    const tokenBody = await parseJsonObject(tokenRes)
    if (!tokenRes.ok) {
      return Response.json({ error: formatProviderError('Feishu token exchange failed', tokenBody) }, { status: 401 })
    }

    const accessToken = readString(tokenBody.access_token)
      ?? readString(tokenBody.user_access_token)
      ?? readString(readObject(tokenBody.data)?.access_token)
      ?? readString(readObject(tokenBody.data)?.user_access_token)
    if (!accessToken) {
      return Response.json({ error: 'Feishu token exchange response did not include access_token' }, { status: 401 })
    }

    const userRes = await fetchImpl(`${apiBaseUrl}/open-apis/authen/v1/user_info`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const userBody = await parseJsonObject(userRes)
    if (!userRes.ok) {
      return Response.json({ error: formatProviderError('Feishu user info request failed', userBody) }, { status: 401 })
    }

    const user = normalizeFeishuUser(readObject(userBody.data) ?? userBody)
    if (!isFeishuUserAllowed(user, env)) {
      return Response.json({ error: 'Registration required' }, { status: 403 })
    }

    const email = normalizeEmail(user.enterpriseEmail ?? user.email)
    const organizationId = isFeishuUserInternal(user, env) ? STORYFLOW_ORGANIZATION_ID : undefined
    const publicUser = {
      provider: 'feishu',
      userId: user.openId,
      ...(organizationId ? { organizationId } : {}),
      ...(email ? { email } : {}),
      ...(user.name ? { name: user.name } : {}),
      ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    }
    const tokens = await createAuthTokens(env, `feishu:${user.openId}`, 'pro', user.name, organizationId)

    return Response.json({
      ok: true,
      user: publicUser,
      ...tokens,
    })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Feishu exchange failed' }, { status: 401 })
  }
}

async function exchangeNeonToken(
  request: Request,
  env: Env,
  fetchImpl: FetchLike,
): Promise<Response> {
  if (!readString(env.CRAFT_WEBUI_NEON_AUTH_BASE_URL)) {
    return Response.json({ error: 'Neon Auth is not configured' }, { status: 404 })
  }
  let baseUrl: string
  let jwksUrl: string
  try {
    baseUrl = normalizeNeonAuthUrl(env.CRAFT_WEBUI_NEON_AUTH_BASE_URL)!
    jwksUrl = normalizeNeonAuthUrl(env.CRAFT_WEBUI_NEON_AUTH_JWKS_URL)
      ?? `${baseUrl}/.well-known/jwks.json`
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : 'Neon Auth URL is invalid',
    }, { status: 503 })
  }

  const token = readBearerToken(request.headers.get('authorization'))
    ?? readString((await readJsonObject(request).catch((): Record<string, unknown> => ({}))).token)
  if (!token) {
    return Response.json({ error: 'Neon Auth token is required' }, { status: 400 })
  }
  const tokenConfigError = getTokenIssuanceConfigError(env)
  if (tokenConfigError) return Response.json({ error: tokenConfigError }, { status: 503 })

  try {
    const origin = new URL(baseUrl).origin
    const issuer = readString(env.CRAFT_WEBUI_NEON_AUTH_ISSUER) ?? origin
    const audience = readString(env.CRAFT_WEBUI_NEON_AUTH_AUDIENCE) ?? origin
    const jwks = createRemoteJWKSet(new URL(jwksUrl), { [customFetch]: fetchImpl })
    const { payload } = await jwtVerify(token, jwks, { issuer, audience })
    const identity = normalizeNeonIdentity(payload)
    const tokens = await createAuthTokens(env, identity.subject, 'standard', identity.name)

    return Response.json({
      ok: true,
      user: {
        provider: 'neon',
        userId: identity.userId,
        ...(identity.email ? { email: identity.email } : {}),
        ...(identity.emailVerified !== undefined ? { emailVerified: identity.emailVerified } : {}),
        ...(identity.name ? { name: identity.name } : {}),
      },
      ...tokens,
    })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Invalid Neon Auth token' }, { status: 401 })
  }
}

async function refreshClientAuthToken(request: Request, env: Env): Promise<Response> {
  const tokenConfigError = getTokenIssuanceConfigError(env)
  if (tokenConfigError) return Response.json({ error: tokenConfigError }, { status: 503 })

  const token = readBearerToken(request.headers.get('authorization'))
  if (!token) return invalidClientSessionResponse()

  try {
    const session = await verifyClientSessionToken(token, env)
    return Response.json({
      ok: true,
      ...await createAuthTokens(
        env,
        session.subject,
        session.modelTier,
        session.userName,
        session.organizationId,
        session.authenticatedAtSeconds,
      ),
    })
  } catch {
    return invalidClientSessionResponse()
  }
}

async function issueSkillsMarketToken(request: Request, env: Env): Promise<Response> {
  const configError = getSkillsMarketTokenConfigError(env)
  if (configError) return Response.json({ error: configError }, { status: 503 })

  const token = readBearerToken(request.headers.get('authorization'))
  if (!token) return invalidClientSessionResponse()

  try {
    const session = await verifyClientSessionToken(token, env, SKILLS_MARKET_TOKEN_TTL_SECONDS)
    return Response.json({
      ok: true,
      marketPublishToken: await createSkillsMarketPublishToken(
        env,
        session.subject,
        session.userName,
        session.organizationId,
        session.authenticatedAtSeconds + CLIENT_SESSION_TOKEN_TTL_SECONDS,
      ),
      expiresInSeconds: SKILLS_MARKET_TOKEN_TTL_SECONDS,
    })
  } catch {
    return invalidClientSessionResponse()
  }
}

async function verifyClientSessionToken(
  token: string,
  env: Env,
  minimumRemainingSeconds = MODEL_ACCESS_TOKEN_TTL_SECONDS,
): Promise<{
  subject: string
  modelTier: 'standard' | 'pro'
  authenticatedAtSeconds: number
  userName?: string
  organizationId?: string
}> {
  const kid = decodeProtectedHeader(token).kid
  if (typeof kid !== 'string' || !kid.trim()) throw new Error('Client session token key id is required')

  const key = [getCurrentClientSessionKey(env), getPreviousClientSessionKey(env)]
    .find(candidate => candidate?.id === kid)
  if (!key) throw new Error('Client session token key is unknown')

  const { payload } = await jwtVerify<ClientSessionPayload>(
    token,
    new TextEncoder().encode(key.secret),
    {
      algorithms: ['HS256'],
      issuer: DEFAULT_GATEWAY_ISSUER,
      audience: DEFAULT_CLIENT_SESSION_AUDIENCE,
    },
  )
  const subject = readString(payload.sub)
  if (!subject) throw new Error('Client session subject is required')
  if (payload.scope !== 'model:issue') throw new Error('Client session scope is invalid')
  if (payload.model_tier !== 'standard' && payload.model_tier !== 'pro') {
    throw new Error('Client session model tier is invalid')
  }
  const authenticatedAtSeconds = typeof payload.auth_time === 'number'
    ? payload.auth_time
    : payload.iat
  const nowSeconds = Math.floor(Date.now() / 1000)
  const expiresAtSeconds = typeof authenticatedAtSeconds === 'number'
    ? authenticatedAtSeconds + CLIENT_SESSION_TOKEN_TTL_SECONDS
    : 0
  if (
    typeof authenticatedAtSeconds !== 'number'
    || !Number.isFinite(authenticatedAtSeconds)
    || authenticatedAtSeconds > nowSeconds + 60
    || expiresAtSeconds <= nowSeconds + minimumRemainingSeconds
  ) {
    throw new Error('Client session authentication time is invalid')
  }
  const userName = normalizeUserName(payload.user_name)
  const organizationId = readString(payload.organization_id)
  return {
    subject,
    modelTier: payload.model_tier,
    authenticatedAtSeconds,
    ...(userName ? { userName } : {}),
    ...(organizationId ? { organizationId } : {}),
  }
}

function invalidClientSessionResponse(): Response {
  return Response.json(
    {
      error: 'Invalid client session token',
      code: 'client_session_token_invalid',
    },
    { status: 401 },
  )
}

async function createAuthTokens(
  env: Env,
  subject: string,
  modelTier: 'standard' | 'pro',
  userName?: string,
  organizationId?: string,
  authenticatedAtSeconds?: number,
): Promise<{ appSessionToken: string, modelAccessToken: string }> {
  const authenticationTime = authenticatedAtSeconds ?? Math.floor(Date.now() / 1000)
  const clientSessionExpiresAt = authenticationTime + CLIENT_SESSION_TOKEN_TTL_SECONDS
  return {
    appSessionToken: await createClientSessionToken(
      env,
      subject,
      modelTier,
      userName,
      organizationId,
      authenticationTime,
    ),
    modelAccessToken: await createModelAccessToken(env, subject, modelTier, userName, clientSessionExpiresAt),
  }
}

async function createClientSessionToken(
  env: Env,
  subject: string,
  modelTier: 'standard' | 'pro',
  userName?: string,
  organizationId?: string,
  authenticatedAtSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const key = getCurrentClientSessionKey(env)
  if (!key) throw new Error('Client session token signing is not configured')
  const nowSeconds = Math.floor(Date.now() / 1000)
  const expiresAtSeconds = authenticatedAtSeconds + CLIENT_SESSION_TOKEN_TTL_SECONDS
  if (expiresAtSeconds <= nowSeconds) throw new Error('Client session has reached its maximum lifetime')

  return new SignJWT({
    scope: 'model:issue',
    model_tier: modelTier,
    auth_time: authenticatedAtSeconds,
    ...(userName ? { user_name: userName } : {}),
    ...(organizationId ? { organization_id: organizationId } : {}),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid: key.id })
    .setIssuer(DEFAULT_GATEWAY_ISSUER)
    .setAudience(DEFAULT_CLIENT_SESSION_AUDIENCE)
    .setSubject(subject)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(expiresAtSeconds)
    .sign(new TextEncoder().encode(key.secret))
}

async function createModelAccessToken(
  env: Env,
  subject: string,
  modelTier: 'standard' | 'pro',
  userName?: string,
  parentExpiresAtSeconds?: number,
): Promise<string> {
  const key = getCurrentModelAccessKey(env)
  if (!key) throw new Error('Model access token signing is not configured')
  const nowSeconds = Math.floor(Date.now() / 1000)
  const expiresAtSeconds = Math.min(
    nowSeconds + MODEL_ACCESS_TOKEN_TTL_SECONDS,
    parentExpiresAtSeconds ?? Number.POSITIVE_INFINITY,
  )
  if (expiresAtSeconds <= nowSeconds) throw new Error('Client session has reached its maximum lifetime')

  return new SignJWT({
    scopes: ['model:chat', 'model:video', 'catalog:read'],
    model_tier: modelTier,
    ...(userName ? { user_name: userName } : {}),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid: key.id })
    .setIssuer(readString(env.STORYFLOW_GATEWAY_JWT_ISSUER) ?? DEFAULT_GATEWAY_ISSUER)
    .setAudience(readString(env.STORYFLOW_GATEWAY_JWT_AUDIENCE) ?? DEFAULT_GATEWAY_AUDIENCE)
    .setSubject(subject)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(expiresAtSeconds)
    .sign(new TextEncoder().encode(key.secret))
}

async function createSkillsMarketPublishToken(
  env: Env,
  subject: string,
  userName?: string,
  organizationId?: string,
  parentExpiresAtSeconds?: number,
): Promise<string> {
  const key = getCurrentSkillsMarketKey(env)
  if (!key) throw new Error('Skills Market token signing is not configured')
  const nowSeconds = Math.floor(Date.now() / 1000)
  const expiresAtSeconds = Math.min(
    nowSeconds + SKILLS_MARKET_TOKEN_TTL_SECONDS,
    parentExpiresAtSeconds ?? Number.POSITIVE_INFINITY,
  )
  if (expiresAtSeconds <= nowSeconds) throw new Error('Client session has reached its maximum lifetime')

  return new SignJWT({
    scopes: ['skills:read', 'skills:publish'],
    ...(userName ? { user_name: userName } : {}),
    ...(organizationId ? { organization_id: organizationId } : {}),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid: key.id })
    .setIssuer(DEFAULT_GATEWAY_ISSUER)
    .setAudience(DEFAULT_SKILLS_MARKET_AUDIENCE)
    .setSubject(subject)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(expiresAtSeconds)
    .sign(new TextEncoder().encode(key.secret))
}

function getTokenIssuanceConfigError(env: Env): string | null {
  const clientSessionKey = getCurrentClientSessionKey(env)
  const modelAccessKey = getCurrentModelAccessKey(env)
  if (!clientSessionKey) return 'Client session token signing is not configured'
  if (!modelAccessKey) return 'Model access token signing is not configured'
  if (
    clientSessionKey.secret === modelAccessKey.secret
    || getPreviousClientSessionKey(env)?.secret === modelAccessKey.secret
  ) {
    return 'Client session and model access tokens require separate signing secrets'
  }
  return null
}

function getBrokerReadinessError(env: Env): string | null {
  const tokenError = getTokenIssuanceConfigError(env)
  if (tokenError) return tokenError
  const marketTokenError = getSkillsMarketTokenConfigError(env)
  if (marketTokenError) return marketTokenError

  const hasFeishu = !!readString(env.CRAFT_WEBUI_FEISHU_APP_ID)
    && !!readString(env.CRAFT_WEBUI_FEISHU_APP_SECRET)
  const neonBaseUrl = readString(env.CRAFT_WEBUI_NEON_AUTH_BASE_URL)
  if (!hasFeishu && !neonBaseUrl) return 'No login provider is configured'
  if (neonBaseUrl) {
    try {
      normalizeNeonAuthUrl(neonBaseUrl)
    } catch (error) {
      return error instanceof Error ? error.message : 'Neon Auth URL is invalid'
    }
  }
  return null
}

function getCurrentClientSessionKey(env: Env): { id: string, secret: string } | null {
  const secret = readString(env.STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET)
  if (!secret) return null
  return {
    id: readString(env.STORYFLOW_CLIENT_SESSION_JWT_CURRENT_KEY_ID) ?? DEFAULT_CURRENT_KEY_ID,
    secret,
  }
}

function getPreviousClientSessionKey(env: Env): { id: string, secret: string } | null {
  const id = readString(env.STORYFLOW_CLIENT_SESSION_JWT_PREVIOUS_KEY_ID)
  const secret = readString(env.STORYFLOW_CLIENT_SESSION_JWT_PREVIOUS_SECRET)
  return id && secret ? { id, secret } : null
}

function getCurrentModelAccessKey(env: Env): { id: string, secret: string } | null {
  const secret = readString(env.STORYFLOW_GATEWAY_JWT_CURRENT_SECRET)
  if (!secret) return null
  return {
    id: readString(env.STORYFLOW_GATEWAY_JWT_CURRENT_KEY_ID) ?? DEFAULT_CURRENT_KEY_ID,
    secret,
  }
}

function getCurrentSkillsMarketKey(env: Env): { id: string, secret: string } | null {
  const secret = readString(env.STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET)
  if (!secret) return null
  return {
    id: readString(env.STORYFLOW_SKILLS_MARKET_JWT_CURRENT_KEY_ID) ?? DEFAULT_CURRENT_KEY_ID,
    secret,
  }
}

function getSkillsMarketTokenConfigError(env: Env): string | null {
  const clientSessionKey = getCurrentClientSessionKey(env)
  const modelAccessKey = getCurrentModelAccessKey(env)
  const marketKey = getCurrentSkillsMarketKey(env)
  if (!marketKey) return 'Skills Market token signing is not configured'
  if (
    marketKey.secret === clientSessionKey?.secret
    || marketKey.secret === modelAccessKey?.secret
    || marketKey.secret === getPreviousClientSessionKey(env)?.secret
  ) {
    return 'Client session, model access, and Skills Market tokens require separate signing secrets'
  }
  return null
}

function normalizeFeishuUser(raw: Record<string, unknown>): FeishuUserInfo {
  const openId = readString(raw.open_id) ?? readString(raw.openId)
  if (!openId) throw new Error('Feishu user info did not include open_id')
  const name = normalizeUserName(raw.name)
    ?? normalizeUserName(raw.en_name)
    ?? normalizeUserName(raw.display_name)
  return {
    openId,
    ...(readString(raw.tenant_key) ?? readString(raw.tenantKey) ? { tenantKey: readString(raw.tenant_key) ?? readString(raw.tenantKey) } : {}),
    ...(readString(raw.email) ? { email: readString(raw.email) } : {}),
    ...(readString(raw.enterprise_email) ?? readString(raw.enterpriseEmail) ? { enterpriseEmail: readString(raw.enterprise_email) ?? readString(raw.enterpriseEmail) } : {}),
    ...(name ? { name } : {}),
    ...(readString(raw.avatar_url) ?? readString(raw.avatarUrl) ? { avatarUrl: readString(raw.avatar_url) ?? readString(raw.avatarUrl) } : {}),
  }
}

function normalizeNeonIdentity(payload: JWTPayload): NeonIdentity {
  const claims = payload as Record<string, unknown>
  if (readBoolean(claims.banned) === true) throw new Error('Neon Auth user is banned')

  const subject = readString(payload.sub) ?? readString(claims.id)
  if (!subject) throw new Error('Neon Auth token did not include a subject')

  const email = normalizeEmail(readString(claims.email))
  const emailVerified = readBoolean(claims.emailVerified)
    ?? readBoolean(claims.email_verified)
  if (emailVerified === false) throw new Error('Email verification is required')

  const name = normalizeUserName(claims.name)
  return {
    provider: 'neon',
    subject: `neon:${subject}`,
    userId: subject,
    ...(email ? { email } : {}),
    ...(emailVerified !== undefined ? { emailVerified } : {}),
    ...(name ? { name } : {}),
  }
}

function isFeishuUserAllowed(user: FeishuUserInfo, env: Env): boolean {
  if (readBoolean(env.CRAFT_WEBUI_FEISHU_ALLOW_ALL_USERS) === true) return true
  return isFeishuUserInternal(user, env)
}

function isFeishuUserInternal(user: FeishuUserInfo, env: Env): boolean {
  const tenantKeys = new Set(readCsv(env.CRAFT_WEBUI_FEISHU_INTERNAL_TENANT_KEYS, []))
  return !!user.tenantKey && tenantKeys.has(user.tenantKey)
}

function isLoopbackRedirectUri(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && url.pathname === '/callback'
  } catch {
    return false
  }
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {}
  return body as Record<string, unknown>
}

async function parseJsonObject(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {}
  return body as Record<string, unknown>
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeUserName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, '').trim()
  return normalized ? normalized.slice(0, 100) : undefined
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return undefined
}

function readCsv(value: string | undefined, fallback: string[]): string[] {
  const result = value?.split(',').map(part => part.trim()).filter(Boolean) ?? []
  return result.length > 0 ? Array.from(new Set(result)) : fallback
}

function readBearerToken(header: string | null): string | undefined {
  if (!header) return undefined
  const [scheme, ...rest] = header.trim().split(/\s+/)
  if (scheme?.toLowerCase() !== 'bearer') return undefined
  return readString(rest.join(' '))
}

function normalizeEmail(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase() || undefined
}

function normalizeNeonAuthUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined

  const url = new URL(trimmed)
  const loopbackHttp = url.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !loopbackHttp) {
    throw new Error('Neon Auth URL must use HTTPS, except for loopback development')
  }
  if (url.username || url.password) {
    throw new Error('Neon Auth URL must not contain credentials')
  }
  return url.toString().replace(/\/+$/, '')
}

function formatProviderError(prefix: string, body: Record<string, unknown>): string {
  const message = readString(body.error_description)
    ?? readString(body.error)
    ?? readString(body.message)
    ?? readString(readObject(body.data)?.message)
  return message ? `${prefix}: ${message}` : prefix
}
