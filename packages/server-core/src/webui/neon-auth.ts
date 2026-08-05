// input: Neon Auth configuration and bearer JWTs from browser login flows.
// output: Public Neon Auth config, normalized identities, and organization-aware session renewal.
// pos: Identity bridge between Neon Auth and the Craft Web UI session gateway.

import { createRemoteJWKSet, customFetch, jwtVerify, type JWTPayload } from 'jose'

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
const NEON_AUTH_REQUEST_TIMEOUT_MS = 15_000

export interface NeonAuthTokenPayload {
  sub?: unknown
  id?: unknown
  email?: unknown
  emailVerified?: unknown
  name?: unknown
  banned?: unknown
  o?: unknown
}

export interface NeonAuthIdentity {
  provider: 'neon'
  userId: string
  subject: string
  email?: string
  emailVerified?: boolean
  name?: string
  organizationId?: string
  organizationRole?: string
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

export interface NeonAuthEmailOtpInput {
  email: string
  otp: string
  origin?: string
}

export interface NeonAuthOrganizationTokenInput {
  sessionCookie: string
  organizationId: string
  origin?: string
}

export interface NeonAuthSessionTokenInput {
  sessionCookie: string
  origin?: string
}

export interface NeonAuthEmailPasswordUser {
  id?: string
  email?: string
  emailVerified?: boolean
  name?: string
}

export type NeonAuthEmailPasswordResult =
  | { status: 'authenticated', token: string, sessionCookie?: string, user?: NeonAuthEmailPasswordUser }
  | { status: 'verification-required', user?: NeonAuthEmailPasswordUser }

export interface NeonAuthClientConfig {
  enabled: boolean
  baseUrl?: string
  emailSignUpEnabled?: boolean
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
  organizationId?: string
  emailSignUpEnabled?: boolean
  fetch?: FetchLike
  tokenVerifier?: NeonAuthTokenVerifier
}

interface NormalizedNeonAuthConfig extends NeonAuthVerifierContext {
  emailSignUpEnabled: boolean
  organizationId?: string
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
      emailSignUpEnabled: this.config.emailSignUpEnabled,
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

    const identity = normalizeNeonAuthIdentity(payload)
    if (
      this.config.organizationId
      && (identity.organizationId !== this.config.organizationId || !identity.organizationRole)
    ) {
      throw new Error('Invitation required')
    }
    return identity
  }

  async authenticateWithEmailPassword(input: NeonAuthEmailPasswordInput): Promise<NeonAuthEmailPasswordResult> {
    if (!this.config) {
      throw new Error('Neon Auth is not configured')
    }

    const rawIdentifier = readString(input.email)
    const identifier = input.mode === 'sign-up'
      ? normalizeSignUpEmailIdentifier(rawIdentifier)
      : normalizeEmailIdentifier(rawIdentifier, this.config.usernameEmailDomain)
    const password = input.password
    if (!identifier) {
      throw new Error(input.mode === 'sign-up'
        ? 'A full email address is required to create an account'
        : this.config.usernameEmailDomain ? 'Email or username is required' : 'Email is required')
    }
    if (!password) throw new Error('Password is required')
    if (input.mode === 'sign-up' && !this.config.emailSignUpEnabled) {
      throw new Error('Email sign-up is disabled')
    }

    const path = input.mode === 'sign-up' ? 'sign-up' : 'sign-in'
    const body: Record<string, unknown> = {
      email: identifier.email,
      password,
    }

    if (input.mode === 'sign-up') {
      body.name = readString(input.name) ?? identifier.email.split('@')[0] ?? 'User'
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

    const sessionCookie = readSessionCookieHeader(res.headers)
    const token = readAuthAccessToken(responseBody, res.headers)
      ?? await this.fetchJsonWebToken(sessionCookie, origin)
    const user = readEmailPasswordUser(responseBody)
    if (input.mode === 'sign-up' && user?.emailVerified === false) {
      return {
        status: 'verification-required',
        user,
      }
    }
    if (token) {
      return {
        status: 'authenticated',
        token,
        ...(sessionCookie ? { sessionCookie } : {}),
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

  async verifyEmailOtp(input: NeonAuthEmailOtpInput): Promise<void> {
    if (!this.config) throw new Error('Neon Auth is not configured')
    const email = normalizeSignUpEmailIdentifier(readString(input.email))?.email
    const otp = readString(input.otp)
    if (!email) throw new Error('A full email address is required')
    if (!otp || !/^\d{6}$/.test(otp)) throw new Error('A 6-digit verification code is required')

    const res = await (this.config.fetch ?? fetch)(`${this.config.baseUrl}/email-otp/verify-email`, {
      method: 'POST',
      headers: buildJsonHeaders(input.origin),
      body: JSON.stringify({ email, otp }),
    })
    const body = await parseJsonObject(res)
    if (!res.ok) throw new Error(formatNeonAuthError('Neon Auth email verification failed', body, res.status))
  }

  async getOrganizationToken(input: NeonAuthOrganizationTokenInput): Promise<string> {
    if (!this.config) throw new Error('Neon Auth is not configured')
    const sessionCookie = readString(input.sessionCookie)
    const organizationId = readString(input.organizationId)
    if (!sessionCookie) throw new Error('Neon Auth session cookie is required')
    if (!organizationId) throw new Error('Neon Auth organization is required')

    let active = await this.postWithSession('/organization/set-active', { organizationId }, sessionCookie, input.origin)
    if (!active.ok) {
      if (active.status === 401) throw new Error('Neon Auth session is required')
      if (active.status !== 403) {
        throw new Error(formatNeonAuthError('Neon Auth organization activation failed', active.body, active.status))
      }
      const invitations = await this.fetchUserInvitations(sessionCookie, input.origin)
      const invitation = invitations.find((candidate) => (
        readString(readValue(candidate, ['organizationId', 'organization_id'])) === organizationId
        && readString(readValue(candidate, ['status'])) === 'pending'
      ))
      const invitationId = readString(readValue(invitation, ['id']))
      if (!invitationId) throw new Error('Invitation required')

      const accepted = await this.postWithSession(
        '/organization/accept-invitation',
        { invitationId },
        sessionCookie,
        input.origin,
      )
      if (!accepted.ok) {
        if (accepted.status === 401) throw new Error('Neon Auth session is required')
        throw new Error(formatNeonAuthError('Neon Auth invitation acceptance failed', accepted.body, accepted.status))
      }
      active = await this.postWithSession('/organization/set-active', { organizationId }, sessionCookie, input.origin)
      if (!active.ok) {
        if (active.status === 401) throw new Error('Neon Auth session is required')
        throw new Error(formatNeonAuthError('Neon Auth organization activation failed', active.body, active.status))
      }
    }

    return this.getSessionToken({ sessionCookie, origin: input.origin })
  }

  async getSessionToken(input: NeonAuthSessionTokenInput): Promise<string> {
    if (!this.config) throw new Error('Neon Auth is not configured')
    const sessionCookie = readString(input.sessionCookie)
    if (!sessionCookie) throw new Error('Neon Auth session cookie is required')
    const token = await this.fetchJsonWebToken(sessionCookie, readString(input.origin))
    if (!token) throw new Error('Neon Auth JWT exchange response did not include a token')
    return token
  }

  private async postWithSession(
    path: string,
    body: Record<string, unknown>,
    sessionCookie: string,
    origin: string | undefined,
  ): Promise<{ ok: boolean, status: number, body: Record<string, unknown> }> {
    const res = await (this.config?.fetch ?? fetch)(`${this.config?.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        ...buildJsonHeaders(origin),
        Cookie: sessionCookie,
      },
      body: JSON.stringify(body),
    })
    return { ok: res.ok, status: res.status, body: await parseJsonObject(res) }
  }

  private async fetchUserInvitations(
    sessionCookie: string,
    origin: string | undefined,
  ): Promise<Record<string, unknown>[]> {
    const headers: Record<string, string> = { Accept: 'application/json', Cookie: sessionCookie }
    const normalizedOrigin = readString(origin)
    if (normalizedOrigin) headers.Origin = normalizedOrigin
    const res = await (this.config?.fetch ?? fetch)(`${this.config?.baseUrl}/organization/list-user-invitations`, {
      method: 'GET',
      headers,
    })
    const body = await parseJsonValue(res)
    if (!res.ok) {
      if (res.status === 401) throw new Error('Neon Auth session is required')
      const errorBody = body && typeof body === 'object' && !Array.isArray(body)
        ? body as Record<string, unknown>
        : {}
      throw new Error(formatNeonAuthError('Neon Auth invitation lookup failed', errorBody, res.status))
    }
    const values = Array.isArray(body)
      ? body
      : readArray(readValue(body, ['data', 'invitations']))
    return values.filter((value): value is Record<string, unknown> => (
      !!value && typeof value === 'object' && !Array.isArray(value)
    ))
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
      if (res.status === 401) throw new Error('Neon Auth session is required')
      throw new Error(formatNeonAuthError('Neon Auth JWT exchange failed', responseBody, res.status))
    }

    return readString(readValue(responseBody, ['token']))
  }
}

export async function reauthorizeNeonClientSession<
  T extends { subject: string, organizationId?: string },
>(
  req: Request,
  neonAuth: NeonAuthService | null,
  clientSession: T,
): Promise<T | Response> {
  if (!clientSession.subject.startsWith('neon:')) return clientSession
  if (!neonAuth?.isConfigured()) {
    return Response.json({ error: 'Neon Auth is not configured' }, { status: 503 })
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const providerToken = readString(body?.providerToken)
  if (!providerToken) {
    return Response.json({
      error: 'Neon Auth session is required',
      code: 'neon_session_required',
    }, { status: 401 })
  }

  try {
    const identity = await neonAuth.verifyToken(providerToken)
    if (identity.subject !== clientSession.subject) {
      return Response.json({
        error: 'Invalid client session token',
        code: 'client_session_token_invalid',
      }, { status: 401 })
    }
    return { ...clientSession, organizationId: identity.organizationId }
  } catch (err) {
    if (err instanceof Error && err.message === 'Invitation required') {
      return Response.json({
        error: 'Invitation required',
        code: 'invitation_required',
      }, { status: 403 })
    }
    return Response.json({
      error: 'Neon Auth session is required',
      code: 'neon_session_required',
    }, { status: 401 })
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
    organizationId: readString(config?.organizationId),
    emailSignUpEnabled: config?.emailSignUpEnabled === true,
    fetch: withRequestTimeout(config?.fetch ?? fetch),
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
  const organization = readObject(payload, ['o'])
  const organizationId = readString(readValue(organization, ['id']))
  const organizationRole = readString(readValue(organization, ['role']))
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
    ...(organizationId ? { organizationId } : {}),
    ...(organizationRole ? { organizationRole } : {}),
  }
}

function normalizeUrlString(value: string | undefined): string | undefined {
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

function withRequestTimeout(fetchImpl: FetchLike): FetchLike {
  return (input, init) => fetchImpl(input, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(NEON_AUTH_REQUEST_TIMEOUT_MS),
  })
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

function normalizeSignUpEmailIdentifier(value: string | undefined): { email: string } | undefined {
  const trimmed = value?.trim()
  if (!trimmed || !trimmed.includes('@')) return undefined

  return { email: trimmed.toLowerCase() }
}

function buildJsonHeaders(origin: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  const normalizedOrigin = readString(origin)
  if (normalizedOrigin) headers.Origin = normalizedOrigin
  return headers
}

async function parseJsonValue(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

async function parseJsonObject(res: Response): Promise<Record<string, unknown>> {
  const body = await parseJsonValue(res)
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
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

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
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
