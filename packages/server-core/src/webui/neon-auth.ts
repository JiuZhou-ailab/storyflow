// input: Neon Auth configuration and bearer JWTs from browser login flows.
// output: Public Neon Auth client config and normalized Web UI session identities.
// pos: Identity bridge between Neon Auth and the Craft Web UI session gateway.

import { createRemoteJWKSet, customFetch, jwtVerify, type JWTPayload } from 'jose'

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface NeonAuthTokenPayload {
  sub?: unknown
  id?: unknown
  email?: unknown
  emailVerified?: unknown
  name?: unknown
  banned?: unknown
}

export interface NeonAuthIdentity {
  provider: 'neon'
  userId: string
  subject: string
  email?: string
  emailVerified?: boolean
  name?: string
}

export type NeonAuthEmailPasswordMode = 'sign-in' | 'sign-up'

export interface NeonAuthEmailPasswordInput {
  mode: NeonAuthEmailPasswordMode
  email: string
  password: string
  name?: string
  origin?: string
  callbackURL?: string
}

export interface NeonAuthEmailPasswordUser {
  id?: string
  email?: string
  emailVerified?: boolean
  name?: string
}

export type NeonAuthEmailPasswordResult =
  | { status: 'authenticated', token: string, user?: NeonAuthEmailPasswordUser }
  | { status: 'verification-required', user?: NeonAuthEmailPasswordUser }

export interface NeonAuthClientConfig {
  enabled: boolean
  baseUrl?: string
  usernameLoginEnabled?: boolean
}

export interface NeonAuthVerifierContext {
  baseUrl: string
  jwksUrl: string
  issuer: string
  audience: string
  usernameEmailDomain?: string
}

export type NeonAuthTokenVerifier = (
  token: string,
  context: NeonAuthVerifierContext,
) => Promise<NeonAuthTokenPayload | null>

export interface NeonAuthConfig {
  baseUrl?: string
  jwksUrl?: string
  issuer?: string
  audience?: string
  usernameEmailDomain?: string
  fetch?: FetchLike
  tokenVerifier?: NeonAuthTokenVerifier
}

interface NormalizedNeonAuthConfig extends NeonAuthVerifierContext {
  fetch?: FetchLike
  tokenVerifier?: NeonAuthTokenVerifier
}

export class NeonAuthService {
  private readonly config: NormalizedNeonAuthConfig | null
  private readonly remoteVerifier: NeonAuthTokenVerifier | null

  constructor(config: NeonAuthConfig | undefined) {
    this.config = normalizeNeonAuthConfig(config)
    this.remoteVerifier = this.config && !this.config.tokenVerifier
      ? createRemoteTokenVerifier(this.config)
      : null
  }

  isConfigured(): boolean {
    return this.config !== null
  }

  getClientConfig(): NeonAuthClientConfig {
    if (!this.config) return { enabled: false }
    return {
      enabled: true,
      baseUrl: this.config.baseUrl,
      ...(this.config.usernameEmailDomain ? { usernameLoginEnabled: true } : {}),
    }
  }

  async verifyToken(token: string): Promise<NeonAuthIdentity> {
    if (!this.config) {
      throw new Error('Neon Auth is not configured')
    }

    const trimmedToken = token.trim()
    if (!trimmedToken) {
      throw new Error('Neon Auth token is required')
    }

    const verifier = this.config.tokenVerifier ?? this.remoteVerifier
    if (!verifier) {
      throw new Error('Neon Auth token verifier is not available')
    }

    const payload = await verifier(trimmedToken, this.config)
    if (!payload) {
      throw new Error('Invalid Neon Auth token')
    }

    return normalizeNeonAuthIdentity(payload)
  }

  async authenticateWithEmailPassword(input: NeonAuthEmailPasswordInput): Promise<NeonAuthEmailPasswordResult> {
    if (!this.config) {
      throw new Error('Neon Auth is not configured')
    }

    const identifier = normalizeEmailIdentifier(readString(input.email), this.config.usernameEmailDomain)
    const password = input.password
    if (!identifier) {
      throw new Error(this.config.usernameEmailDomain ? 'Email or username is required' : 'Email is required')
    }
    if (!password) throw new Error('Password is required')

    const path = input.mode === 'sign-up' ? 'sign-up' : 'sign-in'
    const body: Record<string, unknown> = {
      email: identifier.email,
      password,
    }

    if (input.mode === 'sign-up') {
      body.name = readString(input.name) ?? identifier.username ?? identifier.email.split('@')[0] ?? 'User'
      if (input.callbackURL) body.callbackURL = input.callbackURL
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
    const origin = readString(input.origin)
    if (origin) headers.Origin = origin

    const res = await (this.config.fetch ?? fetch)(`${this.config.baseUrl}/${path}/email`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    const responseBody = await parseJsonObject(res)

    if (!res.ok) {
      throw new Error(formatNeonAuthError(`Neon Auth email ${path} failed`, responseBody, res.status))
    }

    const token = readAuthAccessToken(responseBody, res.headers)
      ?? await this.fetchJsonWebToken(readSessionCookieHeader(res.headers), origin)
    const user = readEmailPasswordUser(responseBody)
    if (token) {
      return {
        status: 'authenticated',
        token,
        ...(user ? { user } : {}),
      }
    }

    if (input.mode === 'sign-up' && user) {
      return {
        status: 'verification-required',
        user,
      }
    }

    throw new Error(`Neon Auth email ${path} response did not include an access token`)
  }

  private async fetchJsonWebToken(cookieHeader: string | undefined, origin: string | undefined): Promise<string | undefined> {
    if (!this.config || !cookieHeader) return undefined

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Cookie: cookieHeader,
    }
    if (origin) headers.Origin = origin

    const res = await (this.config.fetch ?? fetch)(`${this.config.baseUrl}/token`, {
      method: 'GET',
      headers,
    })
    const responseBody = await parseJsonObject(res)

    if (!res.ok) {
      throw new Error(formatNeonAuthError('Neon Auth JWT exchange failed', responseBody, res.status))
    }

    return readString(readValue(responseBody, ['token']))
  }
}

function normalizeNeonAuthConfig(config: NeonAuthConfig | undefined): NormalizedNeonAuthConfig | null {
  const baseUrl = normalizeUrlString(config?.baseUrl)
  if (!baseUrl) return null

  const origin = new URL(baseUrl).origin
  return {
    baseUrl,
    jwksUrl: normalizeUrlString(config?.jwksUrl) ?? `${baseUrl}/.well-known/jwks.json`,
    issuer: config?.issuer?.trim() || origin,
    audience: config?.audience?.trim() || origin,
    usernameEmailDomain: normalizeUsernameEmailDomain(config?.usernameEmailDomain),
    fetch: config?.fetch,
    tokenVerifier: config?.tokenVerifier,
  }
}

function createRemoteTokenVerifier(config: NormalizedNeonAuthConfig): NeonAuthTokenVerifier {
  const options = config.fetch
    ? { [customFetch]: config.fetch }
    : undefined
  const jwks = createRemoteJWKSet(new URL(config.jwksUrl), options)

  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ['EdDSA'],
    })
    return payload as JWTPayload & NeonAuthTokenPayload
  }
}

function normalizeNeonAuthIdentity(payload: NeonAuthTokenPayload): NeonAuthIdentity {
  if (payload.banned === true) {
    throw new Error('Neon Auth user is banned')
  }

  const userId = readString(payload.sub) ?? readString(payload.id)
  if (!userId) {
    throw new Error('Neon Auth token did not include a subject')
  }

  const email = normalizeEmail(readString(payload.email))
  const name = readString(payload.name)
  const emailVerified = typeof payload.emailVerified === 'boolean'
    ? payload.emailVerified
    : undefined

  return {
    provider: 'neon',
    userId,
    subject: `neon:${userId}`,
    ...(email ? { email } : {}),
    ...(emailVerified !== undefined ? { emailVerified } : {}),
    ...(name ? { name } : {}),
  }
}

function normalizeUrlString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined

  const url = new URL(trimmed)
  return url.toString().replace(/\/+$/, '')
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function normalizeEmail(value: string | undefined): string | undefined {
  return value?.toLowerCase()
}

function normalizeUsernameEmailDomain(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase().replace(/^@+/, '')
  if (!trimmed) return undefined
  if (!/^[a-z0-9.-]+$/.test(trimmed)) {
    throw new Error('Neon Auth username email domain contains invalid characters')
  }
  return trimmed
}

function normalizeEmailIdentifier(
  value: string | undefined,
  usernameEmailDomain: string | undefined,
): { email: string, username?: string } | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined

  if (trimmed.includes('@')) {
    return { email: trimmed.toLowerCase() }
  }

  if (!usernameEmailDomain) return undefined

  const username = trimmed.toLowerCase()
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw new Error('Username can only contain letters, numbers, dots, underscores, and hyphens')
  }

  return {
    email: `${username}@${usernameEmailDomain}`,
    username,
  }
}

async function parseJsonObject(res: Response): Promise<Record<string, unknown>> {
  try {
    const body = await res.json()
    return body && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function readAuthAccessToken(body: Record<string, unknown>, headers: Headers): string | undefined {
  const data = readObject(body, ['data'])
  const session = readObject(data, ['session']) ?? readObject(body, ['session'])

  return readString(readValue(session, ['access_token', 'accessToken']))
    ?? readString(readValue(data, ['access_token', 'accessToken']))
    ?? readString(readValue(body, ['access_token', 'accessToken']))
    ?? readString(headers.get('set-auth-jwt'))
    ?? readCompactJwt(readString(readValue(data, ['token'])))
    ?? readCompactJwt(readString(readValue(body, ['token'])))
}

function readCompactJwt(value: string | undefined): string | undefined {
  return value && value.split('.').length === 3 ? value : undefined
}

function readSessionCookieHeader(headers: Headers): string | undefined {
  const setCookie = headers.get('set-cookie')
  if (!setCookie) return undefined

  const cookiePairs = splitSetCookieHeader(setCookie)
    .map((cookie) => cookie.split(';')[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie))

  return cookiePairs.length > 0 ? cookiePairs.join('; ') : undefined
}

function splitSetCookieHeader(value: string): string[] {
  return value.split(/,(?=\s*[^;,]+=)/)
}

function readEmailPasswordUser(body: Record<string, unknown>): NeonAuthEmailPasswordUser | undefined {
  const data = readObject(body, ['data'])
  const session = readObject(data, ['session']) ?? readObject(body, ['session'])
  const user = readObject(data, ['user'])
    ?? readObject(body, ['user'])
    ?? readObject(session, ['user'])
  if (!user) return undefined

  const id = readString(readValue(user, ['id', 'sub']))
  const email = normalizeEmail(readString(readValue(user, ['email'])))
  const name = readString(readValue(user, ['name']))
  const emailVerified = readBoolean(readValue(user, ['emailVerified', 'email_verified']))

  return {
    ...(id ? { id } : {}),
    ...(email ? { email } : {}),
    ...(emailVerified !== undefined ? { emailVerified } : {}),
    ...(name ? { name } : {}),
  }
}

function formatNeonAuthError(prefix: string, body: Record<string, unknown>, status: number): string {
  const error = readObject(body, ['error'])
  const message = readString(readValue(error, ['message']))
    ?? readString(readValue(body, ['message', 'error_description', 'code']))
  return message ? `${message}` : `${prefix}: HTTP ${status}`
}

function readObject(value: unknown, keys: string[]): Record<string, unknown> | undefined {
  const found = readValue(value, keys)
  return found && typeof found === 'object' && !Array.isArray(found)
    ? found as Record<string, unknown>
    : undefined
}

function readValue(value: unknown, keys: string[]): unknown {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  for (const key of keys) {
    if (record[key] !== undefined) return record[key]
  }
  return undefined
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}
