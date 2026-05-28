// input: OpenAI-compatible desktop model requests and broker-issued gateway JWTs
// output: Proxied Cloudflare AI Gateway requests with server-side provider credentials
// pos: Edge model gateway that keeps Cloudflare and upstream model credentials out of desktop builds

export interface Env {
  STORYFLOW_GATEWAY_JWT_SECRET?: string
  STORYFLOW_GATEWAY_JWT_AUDIENCE?: string
  STORYFLOW_GATEWAY_JWT_ISSUER?: string
  CLOUDFLARE_AI_GATEWAY_TOKEN?: string
  WANGSU_UPSTREAM_BASE_URL?: string
  XIAOMI_UPSTREAM_BASE_URL?: string
}

type FetchLike = (request: Request) => Promise<Response>

interface RouteConfig {
  connectionSlug: string
  upstreamEnvKey: keyof Env
}

interface GatewayJwtPayload {
  iss?: unknown
  aud?: unknown
  exp?: unknown
  nbf?: unknown
  scopes?: unknown
  connections?: unknown
}

const DEFAULT_AUDIENCE = 'storyflow-model-gateway'
const DEFAULT_ISSUER = 'storyflow-auth-broker'

const ROUTES: Record<string, RouteConfig> = {
  wangsu: {
    connectionSlug: 'wangsu-default',
    upstreamEnvKey: 'WANGSU_UPSTREAM_BASE_URL',
  },
  xiaomi: {
    connectionSlug: 'xiaomi-default',
    upstreamEnvKey: 'XIAOMI_UPSTREAM_BASE_URL',
  },
}

class ForbiddenGatewayTokenError extends Error {}

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
  const requestUrl = new URL(request.url)
  if (requestUrl.pathname === '/health') {
    return Response.json({ status: 'ok' })
  }

  const route = resolveRoute(requestUrl.pathname)
  if (!route) {
    return Response.json({ error: 'Unknown model gateway route' }, { status: 404 })
  }

  const token = readBearerToken(request.headers.get('authorization'))
    ?? readBearerToken(request.headers.get('cf-aig-authorization'))
  if (!token) {
    return Response.json({ error: 'Model gateway token is required' }, { status: 401 })
  }

  let payload: GatewayJwtPayload
  try {
    payload = await verifyGatewayJwt(token, env)
    assertRouteAllowed(payload, route.config.connectionSlug)
  } catch (err) {
    if (err instanceof ForbiddenGatewayTokenError) {
      return Response.json({ error: err.message }, { status: 403 })
    }
    return Response.json({ error: 'Invalid model gateway token' }, { status: 401 })
  }

  const cloudflareToken = readRequiredEnv(env.CLOUDFLARE_AI_GATEWAY_TOKEN)
  if (!cloudflareToken) {
    return Response.json({ error: 'Cloudflare AI Gateway token is not configured' }, { status: 503 })
  }

  const upstreamBaseUrl = readRequiredEnv(env[route.config.upstreamEnvKey])
  if (!upstreamBaseUrl) {
    return Response.json({ error: 'Model gateway upstream is not configured' }, { status: 503 })
  }

  const upstreamUrl = buildUpstreamUrl(upstreamBaseUrl, route.remainingPath, requestUrl.search)
  const upstreamHeaders = new Headers(request.headers)
  upstreamHeaders.delete('authorization')
  upstreamHeaders.delete('cf-aig-authorization')
  upstreamHeaders.delete('host')
  upstreamHeaders.set('cf-aig-authorization', `Bearer ${cloudflareToken}`)

  const init: RequestInit = {
    method: request.method,
    headers: upstreamHeaders,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
  }

  return fetchImpl(new Request(upstreamUrl, init))
}

export async function verifyGatewayJwt(token: string, env: Env): Promise<GatewayJwtPayload> {
  const secret = readRequiredEnv(env.STORYFLOW_GATEWAY_JWT_SECRET)
  if (!secret) {
    throw new Error('Gateway JWT secret is not configured')
  }

  const parts = token.split('.')
  if (parts.length !== 3 || parts.some(part => !part)) {
    throw new Error('Malformed JWT')
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string]
  const header = decodeBase64UrlJson(encodedHeader) as Record<string, unknown>
  if (header.alg !== 'HS256') {
    throw new Error('Unsupported JWT algorithm')
  }

  const validSignature = await verifyHmacSignature(
    secret,
    `${encodedHeader}.${encodedPayload}`,
    encodedSignature,
  )
  if (!validSignature) {
    throw new Error('Invalid JWT signature')
  }

  const payload = decodeBase64UrlJson(encodedPayload) as GatewayJwtPayload
  assertTemporalClaims(payload)
  assertIssuer(payload, env.STORYFLOW_GATEWAY_JWT_ISSUER ?? DEFAULT_ISSUER)
  assertAudience(payload, env.STORYFLOW_GATEWAY_JWT_AUDIENCE ?? DEFAULT_AUDIENCE)
  assertScope(payload, 'model:chat')
  return payload
}

function resolveRoute(pathname: string): { config: RouteConfig, remainingPath: string } | null {
  const [, routeName, ...rest] = pathname.split('/')
  const config = routeName ? ROUTES[routeName] : undefined
  if (!config) return null

  const remainingPath = `/${rest.join('/')}`
  return {
    config,
    remainingPath: remainingPath === '/' ? '/v1/chat/completions' : remainingPath,
  }
}

function buildUpstreamUrl(baseUrl: string, remainingPath: string, search: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '')
  const normalizedPath = remainingPath.startsWith('/') ? remainingPath : `/${remainingPath}`
  return `${normalizedBase}${normalizedPath}${search}`
}

function assertTemporalClaims(payload: GatewayJwtPayload): void {
  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    throw new Error('Expired JWT')
  }
  if (typeof payload.nbf === 'number' && payload.nbf > now) {
    throw new Error('JWT is not active yet')
  }
}

function assertIssuer(payload: GatewayJwtPayload, expectedIssuer: string): void {
  if (payload.iss !== expectedIssuer) {
    throw new Error('Invalid JWT issuer')
  }
}

function assertAudience(payload: GatewayJwtPayload, expectedAudience: string): void {
  if (typeof payload.aud === 'string' && payload.aud === expectedAudience) return
  if (Array.isArray(payload.aud) && payload.aud.includes(expectedAudience)) return
  throw new Error('Invalid JWT audience')
}

function assertScope(payload: GatewayJwtPayload, expectedScope: string): void {
  if (!Array.isArray(payload.scopes) || !payload.scopes.includes(expectedScope)) {
    throw new ForbiddenGatewayTokenError('Model chat scope is required')
  }
}

function assertRouteAllowed(payload: GatewayJwtPayload, connectionSlug: string): void {
  if (!Array.isArray(payload.connections)) return

  const connections = payload.connections.filter((value): value is string => typeof value === 'string')
  if (connections.length === 0 || connections.includes(connectionSlug)) return
  throw new ForbiddenGatewayTokenError('Model gateway route is not authorized')
}

async function verifyHmacSignature(
  secret: string,
  signingInput: string,
  encodedSignature: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  return crypto.subtle.verify(
    'HMAC',
    key,
    decodeBase64UrlBytes(encodedSignature),
    new TextEncoder().encode(signingInput),
  )
}

function readBearerToken(header: string | null): string | null {
  if (!header) return null
  const [scheme, ...rest] = header.trim().split(/\s+/)
  if (scheme?.toLowerCase() !== 'bearer') return null
  const token = rest.join(' ').trim()
  return token || null
}

function readRequiredEnv(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed || null
}

function decodeBase64UrlJson(value: string): unknown {
  const text = new TextDecoder().decode(decodeBase64UrlBytes(value))
  return JSON.parse(text)
}

function decodeBase64UrlBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
