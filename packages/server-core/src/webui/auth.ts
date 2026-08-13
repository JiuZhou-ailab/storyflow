// input: Web UI credentials, session cookies, and verified desktop identities
// output: Signed Web UI sessions plus renewable desktop, model, and company-scoped Skills Market tokens
// pos: Server-core JWT boundary shared by browser auth and the local desktop auth broker

import { decodeProtectedHeader, SignJWT, jwtVerify } from 'jose'

// ---------------------------------------------------------------------------
// JWT helpers (via jose library)
// ---------------------------------------------------------------------------

const JWT_EXPIRY_SECONDS = 86_400 // 24 hours
const CLIENT_SESSION_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60
const MODEL_ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60
const MODEL_ACCESS_TOKEN_MIN_REMAINING_SECONDS = 12 * 60 * 60 + 5 * 60
export const SKILLS_MARKET_TOKEN_TTL_SECONDS = 300
const MODEL_ACCESS_TOKEN_ISSUER = 'storyflow-auth-broker'
const MODEL_ACCESS_TOKEN_AUDIENCE = 'storyflow-model-gateway'
const SKILLS_MARKET_TOKEN_AUDIENCE = 'storyflow-skills-market'
const CLIENT_SESSION_TOKEN_AUDIENCE = 'storyflow-client-auth'

export interface JwtPayload {
  sub: string
  iat: number
  exp: number
}

export interface JwtSigningKey {
  id: string
  secret: string
}

export interface JwtKeyRing {
  current: JwtSigningKey
  previous?: JwtSigningKey
}

export async function signJwt(payload: JwtPayload, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret)
  return new SignJWT({ sub: payload.sub } as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(payload.iat)
    .setExpirationTime(payload.exp)
    .sign(key)
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const key = new TextEncoder().encode(secret)
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] })
    return {
      sub: payload.sub as string,
      iat: payload.iat as number,
      exp: payload.exp as number,
    }
  } catch {
    return null
  }
}

export async function createSessionToken(secret: string, subject = 'webui'): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return signJwt({ sub: subject, iat: now, exp: now + JWT_EXPIRY_SECONDS }, secret)
}

export async function createClientSessionToken(
  key: JwtSigningKey,
  subject: string,
  modelTier: 'standard' | 'pro',
  authenticatedAtSeconds = Math.floor(Date.now() / 1000),
  organizationId?: string,
  userName?: string,
): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const expiresAtSeconds = authenticatedAtSeconds + CLIENT_SESSION_TOKEN_TTL_SECONDS
  if (expiresAtSeconds <= nowSeconds) throw new Error('Client session has reached its maximum lifetime')

  return new SignJWT({
    scope: 'model:issue',
    model_tier: modelTier,
    auth_time: authenticatedAtSeconds,
    ...(organizationId ? { organization_id: organizationId } : {}),
    ...(userName ? { user_name: userName } : {}),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid: key.id })
    .setIssuer(MODEL_ACCESS_TOKEN_ISSUER)
    .setAudience(CLIENT_SESSION_TOKEN_AUDIENCE)
    .setSubject(subject)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(expiresAtSeconds)
    .sign(new TextEncoder().encode(key.secret))
}

export async function verifyClientSessionToken(
  token: string,
  keys: JwtKeyRing,
  minimumRemainingSeconds = MODEL_ACCESS_TOKEN_MIN_REMAINING_SECONDS,
): Promise<{
  subject: string
  modelTier: 'standard' | 'pro'
  authenticatedAtSeconds: number
  organizationId?: string
  userName?: string
} | null> {
  try {
    const kid = decodeProtectedHeader(token).kid
    if (typeof kid !== 'string' || !kid.trim()) return null
    const key = [keys.current, keys.previous].find(candidate => candidate?.id === kid)
    if (!key) return null

    const { payload } = await jwtVerify(token, new TextEncoder().encode(key.secret), {
      algorithms: ['HS256'],
      issuer: MODEL_ACCESS_TOKEN_ISSUER,
      audience: CLIENT_SESSION_TOKEN_AUDIENCE,
    })
    if (
      typeof payload.sub !== 'string'
      || payload.scope !== 'model:issue'
      || (payload.model_tier !== 'standard' && payload.model_tier !== 'pro')
    ) {
      return null
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
      return null
    }
    const organizationId = typeof payload.organization_id === 'string' && payload.organization_id.trim()
      ? payload.organization_id.trim()
      : undefined
    const userName = typeof payload.user_name === 'string' && payload.user_name.trim()
      ? payload.user_name.trim()
      : undefined
    return {
      subject: payload.sub,
      modelTier: payload.model_tier,
      authenticatedAtSeconds,
      ...(organizationId ? { organizationId } : {}),
      ...(userName ? { userName } : {}),
    }
  } catch {
    return null
  }
}

export async function createModelAccessToken(
  key: JwtSigningKey,
  subject: string,
  modelTier: 'standard' | 'pro',
  parentAuthenticatedAtSeconds?: number,
): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const parentExpiresAtSeconds = parentAuthenticatedAtSeconds === undefined
    ? Number.POSITIVE_INFINITY
    : parentAuthenticatedAtSeconds + CLIENT_SESSION_TOKEN_TTL_SECONDS
  const expiresAtSeconds = Math.min(
    nowSeconds + MODEL_ACCESS_TOKEN_TTL_SECONDS,
    parentExpiresAtSeconds,
  )
  if (expiresAtSeconds <= nowSeconds) throw new Error('Client session has reached its maximum lifetime')

  return new SignJWT({
    scopes: ['model:chat'],
    model_tier: modelTier,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid: key.id })
    .setIssuer(MODEL_ACCESS_TOKEN_ISSUER)
    .setAudience(MODEL_ACCESS_TOKEN_AUDIENCE)
    .setSubject(subject)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(expiresAtSeconds)
    .sign(new TextEncoder().encode(key.secret))
}

export async function createSkillsMarketPublishToken(
  key: JwtSigningKey,
  subject: string,
  parentAuthenticatedAtSeconds: number,
  organizationId?: string,
  userName?: string,
): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const expiresAtSeconds = Math.min(
    nowSeconds + SKILLS_MARKET_TOKEN_TTL_SECONDS,
    parentAuthenticatedAtSeconds + CLIENT_SESSION_TOKEN_TTL_SECONDS,
  )
  if (expiresAtSeconds <= nowSeconds) throw new Error('Client session has reached its maximum lifetime')

  return new SignJWT({
    scopes: ['skills:read', 'skills:publish'],
    ...(organizationId ? { organization_id: organizationId } : {}),
    ...(userName ? { user_name: userName } : {}),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid: key.id })
    .setIssuer(MODEL_ACCESS_TOKEN_ISSUER)
    .setAudience(SKILLS_MARKET_TOKEN_AUDIENCE)
    .setSubject(subject)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(expiresAtSeconds)
    .sign(new TextEncoder().encode(key.secret))
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

const SESSION_COOKIE_NAME = 'craft_session'

export function buildSessionCookie(jwt: string, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${jwt}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${JWT_EXPIRY_SECONDS}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function buildLogoutCookie(secure = false): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=0',
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function extractSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  for (const pair of cookieHeader.split(';')) {
    const [name, ...rest] = pair.trim().split('=')
    if (name === SESSION_COOKIE_NAME) return rest.join('=')
  }
  return null
}

// ---------------------------------------------------------------------------
// Password verification (argon2id via Bun.password)
// ---------------------------------------------------------------------------

let hashedPassword: string | null = null

/**
 * Hash the login password at startup. Must be called before any auth requests.
 * The hash is stored in memory — the raw password is not retained.
 */
export async function initPasswordHash(plaintext: string): Promise<void> {
  hashedPassword = await Bun.password.hash(plaintext, { algorithm: 'argon2id' })
}

/**
 * Verify a user-supplied password against the pre-hashed password.
 * Uses Bun's built-in argon2id verification (constant-time).
 */
export async function verifyPassword(input: string): Promise<boolean> {
  if (!hashedPassword) return false
  return Bun.password.verify(input, hashedPassword)
}

// ---------------------------------------------------------------------------
// Rate limiter (per-IP + global, sliding window)
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  attempts: number
  windowStart: number
}

export class RateLimiter {
  private entries = new Map<string, RateLimitEntry>()
  private readonly maxAttempts: number
  private readonly windowMs: number
  /** Global counter — blocks all IPs after too many total failures (defeats IP spoofing). */
  private readonly maxGlobalAttempts: number
  private globalAttempts = 0
  private globalWindowStart = Date.now()

  constructor(maxAttempts = 5, windowMs = 60_000, maxGlobalAttempts = 20) {
    this.maxAttempts = maxAttempts
    this.windowMs = windowMs
    this.maxGlobalAttempts = maxGlobalAttempts
  }

  /** Returns true if the request should be allowed, false if rate-limited. */
  check(ip: string): boolean {
    const now = Date.now()

    // Reset global window if expired
    if (now - this.globalWindowStart > this.windowMs) {
      this.globalAttempts = 0
      this.globalWindowStart = now
    }

    // Global rate limit — blocks everyone if too many total attempts
    this.globalAttempts++
    if (this.globalAttempts > this.maxGlobalAttempts) return false

    // Per-IP rate limit
    const entry = this.entries.get(ip)

    if (!entry || now - entry.windowStart > this.windowMs) {
      this.entries.set(ip, { attempts: 1, windowStart: now })
      return true
    }

    entry.attempts++
    if (entry.attempts > this.maxAttempts) return false
    return true
  }

  /** Periodic cleanup of stale entries (call on a timer). */
  cleanup(): void {
    const now = Date.now()
    for (const [ip, entry] of this.entries) {
      if (now - entry.windowStart > this.windowMs * 2) {
        this.entries.delete(ip)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Session validator (used by both HTTP and WebSocket)
// ---------------------------------------------------------------------------

export async function validateSession(
  cookieHeader: string | null,
  secret: string,
): Promise<JwtPayload | null> {
  const token = extractSessionCookie(cookieHeader)
  if (!token) return null
  return verifyJwt(token, secret)
}
