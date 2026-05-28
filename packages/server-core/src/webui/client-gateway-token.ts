// input: Authenticated desktop identity and server-side gateway token configuration
// output: Short-lived model gateway token for the desktop client
// pos: Auth broker boundary between login identity and managed model gateway access
import { SignJWT } from 'jose'

export const DEFAULT_CLIENT_GATEWAY_TOKEN_AUDIENCE = 'storyflow-model-gateway'
export const DEFAULT_CLIENT_GATEWAY_TOKEN_ISSUER = 'storyflow-auth-broker'
export const DEFAULT_CLIENT_GATEWAY_TOKEN_TTL_SECONDS = 12 * 60 * 60

export interface ClientGatewayTokenIdentity {
  provider: 'neon' | 'feishu'
  subject: string
  userId: string
  email?: string
  emailVerified?: boolean
  name?: string
}

export interface ClientGatewayTokenConfig {
  staticToken?: string
  jwtSecret?: string
  ttlSeconds?: number
  audience?: string
  issuer?: string
  connectionSlugs?: string[]
}

export async function createClientGatewayToken(
  config: ClientGatewayTokenConfig,
  identity: ClientGatewayTokenIdentity,
): Promise<string | undefined> {
  const jwtSecret = readOptionalSecret(config.jwtSecret)
  if (jwtSecret) {
    return signClientGatewayJwt(config, identity, jwtSecret)
  }

  return readOptionalSecret(config.staticToken)
}

async function signClientGatewayJwt(
  config: ClientGatewayTokenConfig,
  identity: ClientGatewayTokenIdentity,
  jwtSecret: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const ttlSeconds = normalizeTtlSeconds(config.ttlSeconds)
  const connections = normalizeConnectionSlugs(config.connectionSlugs)
  const payload: Record<string, unknown> = {
    provider: identity.provider,
    userId: identity.userId,
    scopes: ['model:chat'],
    connections,
  }

  if (identity.email) payload.email = identity.email
  if (identity.emailVerified !== undefined) payload.emailVerified = identity.emailVerified
  if (identity.name) payload.name = identity.name

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .setIssuer(readOptionalSecret(config.issuer) ?? DEFAULT_CLIENT_GATEWAY_TOKEN_ISSUER)
    .setAudience(readOptionalSecret(config.audience) ?? DEFAULT_CLIENT_GATEWAY_TOKEN_AUDIENCE)
    .setSubject(identity.subject)
    .sign(new TextEncoder().encode(jwtSecret))
}

function normalizeTtlSeconds(value: number | undefined): number {
  if (!Number.isFinite(value) || value == null || value <= 0) {
    return DEFAULT_CLIENT_GATEWAY_TOKEN_TTL_SECONDS
  }
  return Math.floor(value)
}

function normalizeConnectionSlugs(slugs: string[] | undefined): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const raw of slugs ?? []) {
    const slug = raw.trim()
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    result.push(slug)
  }

  return result
}

function readOptionalSecret(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}
