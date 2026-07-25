// input: OpenAI-compatible desktop chat requests and broker-issued model access JWTs
// output: NewAPI chat requests with the server-only service credential
// pos: Edge authorization boundary that keeps NewAPI credentials out of desktop builds
import { jwtVerify, type JWTPayload } from 'jose'

export interface Env {
  STORYFLOW_GATEWAY_JWT_SECRET?: string
  STORYFLOW_GATEWAY_JWT_AUDIENCE?: string
  STORYFLOW_GATEWAY_JWT_ISSUER?: string
  NEWAPI_API_KEY?: string
  NEWAPI_UPSTREAM_BASE_URL?: string
}

type FetchLike = (request: Request) => Promise<Response>

interface GatewayJwtPayload extends JWTPayload {
  scopes?: unknown
  model_tier?: unknown
}

const DEFAULT_AUDIENCE = 'storyflow-model-gateway'
const DEFAULT_ISSUER = 'storyflow-auth-broker'
const CHAT_COMPLETIONS_PATH = '/v1/chat/completions'

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
    if (request.method !== 'GET') {
      return methodNotAllowed('GET')
    }
    return Response.json({ status: 'ok' })
  }

  if (requestUrl.pathname !== CHAT_COMPLETIONS_PATH) {
    return Response.json({ error: 'Unknown model gateway route' }, { status: 404 })
  }
  if (request.method !== 'POST') {
    return methodNotAllowed('POST')
  }

  const token = readBearerToken(request.headers.get('authorization'))
  if (!token) {
    return Response.json({ error: 'Model access token is required' }, { status: 401 })
  }

  try {
    await verifyGatewayJwt(token, env)
  } catch (error) {
    if (error instanceof ForbiddenGatewayTokenError) {
      return Response.json({ error: error.message }, { status: 403 })
    }
    return Response.json({ error: 'Invalid model access token' }, { status: 401 })
  }

  const newApiKey = readRequiredEnv(env.NEWAPI_API_KEY)
  const upstreamBaseUrl = readRequiredEnv(env.NEWAPI_UPSTREAM_BASE_URL)
  if (!newApiKey || !upstreamBaseUrl) {
    return Response.json({ error: 'NewAPI gateway is not configured' }, { status: 503 })
  }

  const upstreamHeaders = new Headers()
  copyHeader(request.headers, upstreamHeaders, 'accept')
  copyHeader(request.headers, upstreamHeaders, 'content-type')
  upstreamHeaders.set('authorization', `Bearer ${newApiKey}`)

  const upstreamRequest = new Request(
    buildUpstreamUrl(upstreamBaseUrl, requestUrl.pathname, requestUrl.search),
    {
      method: 'POST',
      headers: upstreamHeaders,
      body: request.body,
    },
  )

  try {
    return await fetchImpl(upstreamRequest)
  } catch {
    return Response.json({ error: 'NewAPI gateway is unavailable' }, { status: 502 })
  }
}

export async function verifyGatewayJwt(token: string, env: Env): Promise<GatewayJwtPayload> {
  const secret = readRequiredEnv(env.STORYFLOW_GATEWAY_JWT_SECRET)
  if (!secret) {
    throw new Error('Gateway JWT secret is not configured')
  }

  const { payload } = await jwtVerify<GatewayJwtPayload>(
    token,
    new TextEncoder().encode(secret),
    {
      algorithms: ['HS256'],
      issuer: env.STORYFLOW_GATEWAY_JWT_ISSUER ?? DEFAULT_ISSUER,
      audience: env.STORYFLOW_GATEWAY_JWT_AUDIENCE ?? DEFAULT_AUDIENCE,
    },
  )
  if (typeof payload.exp !== 'number') {
    throw new Error('Model access token expiry is required')
  }
  assertSubject(payload)
  assertScope(payload, 'model:chat')
  assertModelTier(payload)
  return payload
}

function methodNotAllowed(allowedMethod: string): Response {
  return Response.json(
    { error: 'Method not allowed' },
    {
      status: 405,
      headers: { Allow: allowedMethod },
    },
  )
}

function buildUpstreamUrl(baseUrl: string, pathname: string, search: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${pathname}${search}`
}

function copyHeader(source: Headers, target: Headers, name: string): void {
  const value = source.get(name)
  if (value) target.set(name, value)
}

function assertSubject(payload: GatewayJwtPayload): void {
  if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
    throw new Error('Model access subject is required')
  }
}

function assertScope(payload: GatewayJwtPayload, expectedScope: string): void {
  if (!Array.isArray(payload.scopes) || !payload.scopes.includes(expectedScope)) {
    throw new ForbiddenGatewayTokenError('Model chat scope is required')
  }
}

function assertModelTier(payload: GatewayJwtPayload): void {
  if (payload.model_tier !== 'standard' && payload.model_tier !== 'pro') {
    throw new ForbiddenGatewayTokenError('Model access tier is not authorized')
  }
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
