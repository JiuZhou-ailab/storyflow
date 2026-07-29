// input: OpenAI Responses or legacy Chat Completions requests and broker-issued model access JWTs
// output: Authenticated NewAPI requests plus minimal structured upstream diagnostics
// pos: Edge authorization boundary that keeps NewAPI credentials out of desktop builds
import { decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose'

export interface Env {
  STORYFLOW_GATEWAY_JWT_CURRENT_KEY_ID?: string
  STORYFLOW_GATEWAY_JWT_CURRENT_SECRET?: string
  STORYFLOW_GATEWAY_JWT_PREVIOUS_KEY_ID?: string
  STORYFLOW_GATEWAY_JWT_PREVIOUS_SECRET?: string
  STORYFLOW_GATEWAY_JWT_AUDIENCE?: string
  STORYFLOW_GATEWAY_JWT_ISSUER?: string
  NEWAPI_API_KEY?: string
  NEWAPI_UPSTREAM_BASE_URL?: string
}

type FetchLike = (request: Request) => Promise<Response>

interface GatewayJwtPayload extends JWTPayload {
  scopes?: unknown
  model_tier?: unknown
  user_name?: unknown
}

interface VerifiedGatewayJwtPayload extends GatewayJwtPayload {
  sub: string
  model_tier: 'standard' | 'pro'
  user_name?: string
}

interface GatewayRequestLogDetails {
  user: string
  user_name?: string
  stage?: 'config' | 'upstream'
  upstream_status?: number
  upstream_ray?: string
  error?: string
}

const DEFAULT_AUDIENCE = 'storyflow-model-gateway'
const DEFAULT_ISSUER = 'storyflow-auth-broker'
const DEFAULT_CURRENT_KEY_ID = 'current'
const MODEL_API_PATHS = new Set(['/v1/responses', '/v1/chat/completions'])

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

  if (requestUrl.pathname === '/ready') {
    if (request.method !== 'GET') {
      return methodNotAllowed('GET')
    }
    return getGatewayReadinessError(env)
      ? Response.json(
          { status: 'not_ready', code: 'configuration_invalid' },
          { status: 503 },
        )
      : Response.json({ status: 'ready' })
  }

  if (!MODEL_API_PATHS.has(requestUrl.pathname)) {
    return Response.json({ error: 'Unknown model gateway route' }, { status: 404 })
  }
  if (request.method !== 'POST') {
    return methodNotAllowed('POST')
  }

  const startedAt = Date.now()
  const token = readBearerToken(request.headers.get('authorization'))
  if (!token) {
    return invalidModelAccessTokenResponse()
  }

  let access: VerifiedGatewayJwtPayload
  try {
    access = await verifyGatewayJwt(token, env)
  } catch (error) {
    if (error instanceof ForbiddenGatewayTokenError) {
      return Response.json({ error: error.message }, { status: 403 })
    }
    return invalidModelAccessTokenResponse()
  }
  const logIdentity = {
    user: access.sub,
    ...(access.user_name ? { user_name: access.user_name } : {}),
  }

  const newApiKey = readRequiredEnv(env.NEWAPI_API_KEY)
  const upstreamBaseUrl = readRequiredEnv(env.NEWAPI_UPSTREAM_BASE_URL)
  if (!newApiKey || !upstreamBaseUrl) {
    logGatewayRequest(startedAt, {
      stage: 'config',
      ...logIdentity,
      error: 'missing_configuration',
    })
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
    const upstreamResponse = await fetchImpl(upstreamRequest)
    if (upstreamResponse.status === 400 && !(await upstreamResponse.clone().text()).trim()) {
      logGatewayRequest(startedAt, {
        stage: 'upstream',
        ...logIdentity,
        upstream_status: 400,
        upstream_ray: upstreamResponse.headers.get('cf-ray') ?? undefined,
        error: 'empty_response_body',
      })
      return Response.json(
        {
          error: {
            message: 'Model provider rejected the request without an error body',
            type: 'upstream_error',
            code: 'upstream_empty_response',
          },
        },
        { status: 502 },
      )
    }
    if (upstreamResponse.status === 401 || upstreamResponse.status === 403) {
      logGatewayRequest(startedAt, {
        stage: 'upstream',
        ...logIdentity,
        upstream_status: upstreamResponse.status,
        upstream_ray: upstreamResponse.headers.get('cf-ray') ?? undefined,
      })
      return Response.json(
        {
          error: 'Model provider authentication failed',
          code: 'upstream_auth_failed',
        },
        { status: 502 },
      )
    }
    logGatewayRequest(
      startedAt,
      upstreamResponse.ok
        ? logIdentity
        : {
            stage: 'upstream',
            ...logIdentity,
            upstream_status: upstreamResponse.status,
            upstream_ray: upstreamResponse.headers.get('cf-ray') ?? undefined,
          },
    )
    return upstreamResponse
  } catch (error) {
    logGatewayRequest(startedAt, {
      stage: 'upstream',
      ...logIdentity,
      error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown upstream fetch error',
    })
    return Response.json({ error: 'NewAPI gateway is unavailable' }, { status: 502 })
  }
}

export async function verifyGatewayJwt(
  token: string,
  env: Env,
): Promise<VerifiedGatewayJwtPayload> {
  const key = resolveGatewayVerificationKey(token, env)

  const { payload } = await jwtVerify<GatewayJwtPayload>(
    token,
    new TextEncoder().encode(key.secret),
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
  const userName = normalizeUserName(payload.user_name)
  const { user_name: _untrustedUserName, ...verifiedPayload } = payload
  return {
    ...verifiedPayload,
    ...(userName ? { user_name: userName } : {}),
  }
}

function resolveGatewayVerificationKey(token: string, env: Env): { id: string, secret: string } {
  const current = getCurrentGatewayKey(env)
  if (!current) throw new Error('Gateway JWT secret is not configured')

  const kid = decodeProtectedHeader(token).kid
  if (typeof kid !== 'string' || !kid.trim()) throw new Error('Gateway JWT key id is required')
  if (kid === current.id) return current

  const previous = getPreviousGatewayKey(env)
  if (previous?.id === kid) return previous
  throw new Error('Gateway JWT key id is unknown')
}

function getCurrentGatewayKey(env: Env): { id: string, secret: string } | null {
  const secret = readRequiredEnv(env.STORYFLOW_GATEWAY_JWT_CURRENT_SECRET)
  if (!secret) return null
  return {
    id: readRequiredEnv(env.STORYFLOW_GATEWAY_JWT_CURRENT_KEY_ID) ?? DEFAULT_CURRENT_KEY_ID,
    secret,
  }
}

function getPreviousGatewayKey(env: Env): { id: string, secret: string } | null {
  const id = readRequiredEnv(env.STORYFLOW_GATEWAY_JWT_PREVIOUS_KEY_ID)
  const secret = readRequiredEnv(env.STORYFLOW_GATEWAY_JWT_PREVIOUS_SECRET)
  return id && secret ? { id, secret } : null
}

function getGatewayReadinessError(env: Env): string | null {
  if (!getCurrentGatewayKey(env)) return 'Gateway JWT current key is not configured'
  if (!readRequiredEnv(env.NEWAPI_API_KEY)) return 'NewAPI key is not configured'
  if (!readRequiredEnv(env.NEWAPI_UPSTREAM_BASE_URL)) return 'NewAPI upstream is not configured'
  return null
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

function invalidModelAccessTokenResponse(): Response {
  return Response.json(
    {
      error: 'Invalid model access token',
      code: 'model_access_token_invalid',
    },
    { status: 401 },
  )
}

function buildUpstreamUrl(baseUrl: string, pathname: string, search: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${pathname}${search}`
}

function copyHeader(source: Headers, target: Headers, name: string): void {
  const value = source.get(name)
  if (value) target.set(name, value)
}

function assertSubject(
  payload: GatewayJwtPayload,
): asserts payload is GatewayJwtPayload & { sub: string } {
  if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
    throw new Error('Model access subject is required')
  }
}

function assertScope(payload: GatewayJwtPayload, expectedScope: string): void {
  if (!Array.isArray(payload.scopes) || !payload.scopes.includes(expectedScope)) {
    throw new ForbiddenGatewayTokenError('Model chat scope is required')
  }
}

function assertModelTier(
  payload: GatewayJwtPayload,
): asserts payload is GatewayJwtPayload & { model_tier: 'standard' | 'pro' } {
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

function normalizeUserName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, '').trim()
  return normalized ? normalized.slice(0, 100) : undefined
}

function logGatewayRequest(
  startedAt: number,
  details: GatewayRequestLogDetails,
): void {
  const entry = {
    ...details,
    duration_ms: Date.now() - startedAt,
  }
  if (details.error || (details.upstream_status !== undefined && details.upstream_status >= 400)) {
    console.error(entry)
  } else {
    console.log(entry)
  }
}
