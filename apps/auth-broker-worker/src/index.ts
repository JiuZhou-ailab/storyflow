// input: Desktop client-auth exchange requests and Feishu/Neon identity provider responses
// output: Public auth config and verified desktop login identity
// pos: HTTPS auth broker for packaged desktop login without shipping server secrets
import { createRemoteJWKSet, customFetch, jwtVerify, type JWTPayload } from 'jose'

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
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface FeishuUserInfo {
  openId: string
  tenantKey?: string
  email?: string
  enterpriseEmail?: string
  name?: string
}

interface NeonIdentity {
  provider: 'feishu' | 'neon'
  subject: string
  userId: string
  email?: string
  emailVerified?: boolean
  name?: string
}

const DEFAULT_FEISHU_AUTH_BASE_URL = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize'
const DEFAULT_FEISHU_API_BASE_URL = 'https://open.feishu.cn'

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
    const publicUser = {
      provider: 'feishu',
      userId: user.openId,
      ...(email ? { email } : {}),
      ...(user.name ? { name: user.name } : {}),
    }

    return Response.json({
      ok: true,
      user: publicUser,
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
  const baseUrl = normalizeUrlString(env.CRAFT_WEBUI_NEON_AUTH_BASE_URL)
  if (!baseUrl) {
    return Response.json({ error: 'Neon Auth is not configured' }, { status: 404 })
  }

  const token = readBearerToken(request.headers.get('authorization'))
    ?? readString((await readJsonObject(request).catch(() => ({}))).token)
  if (!token) {
    return Response.json({ error: 'Neon Auth token is required' }, { status: 400 })
  }

  try {
    const origin = new URL(baseUrl).origin
    const jwksUrl = normalizeUrlString(env.CRAFT_WEBUI_NEON_AUTH_JWKS_URL) ?? `${baseUrl}/.well-known/jwks.json`
    const issuer = readString(env.CRAFT_WEBUI_NEON_AUTH_ISSUER) ?? origin
    const audience = readString(env.CRAFT_WEBUI_NEON_AUTH_AUDIENCE) ?? origin
    const jwks = createRemoteJWKSet(new URL(jwksUrl), { [customFetch]: fetchImpl })
    const { payload } = await jwtVerify(token, jwks, { issuer, audience })
    const identity = normalizeNeonIdentity(payload)

    return Response.json({
      ok: true,
      user: {
        provider: 'neon',
        userId: identity.userId,
        ...(identity.email ? { email: identity.email } : {}),
        ...(identity.emailVerified !== undefined ? { emailVerified: identity.emailVerified } : {}),
        ...(identity.name ? { name: identity.name } : {}),
      },
    })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Invalid Neon Auth token' }, { status: 401 })
  }
}

function normalizeFeishuUser(raw: Record<string, unknown>): FeishuUserInfo {
  const openId = readString(raw.open_id) ?? readString(raw.openId)
  if (!openId) throw new Error('Feishu user info did not include open_id')
  return {
    openId,
    ...(readString(raw.tenant_key) ?? readString(raw.tenantKey) ? { tenantKey: readString(raw.tenant_key) ?? readString(raw.tenantKey) } : {}),
    ...(readString(raw.email) ? { email: readString(raw.email) } : {}),
    ...(readString(raw.enterprise_email) ?? readString(raw.enterpriseEmail) ? { enterpriseEmail: readString(raw.enterprise_email) ?? readString(raw.enterpriseEmail) } : {}),
    ...(readString(raw.name) ? { name: readString(raw.name) } : {}),
  }
}

function normalizeNeonIdentity(payload: JWTPayload): NeonIdentity {
  const subject = readString(payload.sub) ?? readString((payload as Record<string, unknown>).id)
  if (!subject) throw new Error('Neon Auth token did not include a subject')

  const email = normalizeEmail(readString((payload as Record<string, unknown>).email))
  const emailVerified = readBoolean((payload as Record<string, unknown>).emailVerified)
    ?? readBoolean((payload as Record<string, unknown>).email_verified)
  const name = readString((payload as Record<string, unknown>).name)
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

function normalizeUrlString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return trimmed.replace(/\/+$/, '')
}

function formatProviderError(prefix: string, body: Record<string, unknown>): string {
  const message = readString(body.error_description)
    ?? readString(body.error)
    ?? readString(body.message)
    ?? readString(readObject(body.data)?.message)
  return message ? `${prefix}: ${message}` : prefix
}
