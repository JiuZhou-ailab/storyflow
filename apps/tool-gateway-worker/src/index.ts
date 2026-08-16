// input: Storyflow tool-operation requests, scoped capability JWTs, and server-only provider credentials
// output: Validated product-level tool responses with provider protocols and secrets contained at the edge
// pos: Cloud authorization and provider-adapter boundary for managed Storyflow tools

import { decodeProtectedHeader, importSPKI, jwtVerify, type JWTPayload } from 'jose'

interface ToolGatewaySecrets {
  STORYFLOW_TOOL_GATEWAY_JWT_CURRENT_PUBLIC_KEY?: string
  STORYFLOW_TOOL_GATEWAY_JWT_PREVIOUS_KEY_ID?: string
  STORYFLOW_TOOL_GATEWAY_JWT_PREVIOUS_PUBLIC_KEY?: string
  ANYSEARCH_API_KEY?: string
  FIRECRAWL_API_KEY?: string
  SEARCH_RATE_LIMITER?: RateLimitBinding
  SCRAPE_RATE_LIMITER?: RateLimitBinding
}

export type ToolGatewayEnv = Env & ToolGatewaySecrets
type FetchLike = (request: Request) => Promise<Response>

interface RateLimitBinding {
  limit(input: { key: string }): Promise<{ success: boolean }>
}

interface ToolGatewayJwtPayload extends JWTPayload {
  scopes?: unknown
}

interface AnySearchResponse {
  error?: { message?: string }
  result?: { content?: Array<{ type?: string, text?: string }> }
}

interface FirecrawlResponse {
  success?: boolean
  error?: string
  data?: {
    markdown?: string
    metadata?: { title?: string, sourceURL?: string, url?: string }
  }
}

const DEFAULT_AUDIENCE = 'storyflow-tool-gateway'
const DEFAULT_ISSUER = 'storyflow-auth-broker'
const DEFAULT_CURRENT_KEY_ID = 'current'
const DEFAULT_ANYSEARCH_URL = 'https://api.anysearch.com/mcp'
const DEFAULT_FIRECRAWL_URL = 'https://api.firecrawl.dev/v2/scrape'
const SEARCH_SCOPE = 'web:search'
const SCRAPE_SCOPE = 'web:scrape'
const REQUEST_BODY_LIMIT_BYTES = 16 * 1024
const UPSTREAM_BODY_LIMIT_BYTES = 1024 * 1024

class ForbiddenToolTokenError extends Error {}
class PayloadTooLargeError extends Error {}

export default {
  fetch(request: Request, env: ToolGatewayEnv): Promise<Response> {
    return handleRequest(request, env, fetch)
  },
}

export async function handleRequest(
  request: Request,
  env: ToolGatewayEnv,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname === '/health') {
    return request.method === 'GET'
      ? Response.json({ status: 'ok' })
      : methodNotAllowed('GET')
  }

  if (url.pathname === '/ready') {
    if (request.method !== 'GET') return methodNotAllowed('GET')
    return await getReadinessError(env)
      ? Response.json({ status: 'not_ready', code: 'configuration_invalid' }, { status: 503 })
      : Response.json({ status: 'ready' })
  }

  const capability = url.pathname === '/v1/search'
    ? SEARCH_SCOPE
    : url.pathname === '/v1/scrape'
      ? SCRAPE_SCOPE
      : null
  if (!capability) {
    return Response.json({ error: 'Unknown tool gateway route' }, { status: 404 })
  }
  if (request.method !== 'POST') return methodNotAllowed('POST')

  const startedAt = Date.now()
  const token = readBearerToken(request.headers.get('authorization'))
  if (!token) {
    logRequest(startedAt, { capability, status: 401 })
    return invalidToolAccessTokenResponse()
  }

  let subject: string
  try {
    subject = await verifyToolGatewayJwt(token, env, capability)
  } catch (error) {
    const status = error instanceof ForbiddenToolTokenError ? 403 : 401
    logRequest(startedAt, { capability, status })
    return status === 403
      ? Response.json({ error: error.message }, { status })
      : invalidToolAccessTokenResponse()
  }

  const rateLimitResponse = await enforceRateLimit(env, subject, capability, startedAt)
  if (rateLimitResponse) return rateLimitResponse

  try {
    const response = capability === SEARCH_SCOPE
      ? await proxySearch(await readSearchInput(request), env, fetchImpl)
      : await proxyScrape(await readScrapeInput(request), env, fetchImpl)
    logRequest(startedAt, { capability, subject, status: response.status })
    return response
  } catch (error) {
    const status = error instanceof PayloadTooLargeError ? 413 : 400
    logRequest(startedAt, { capability, subject, status })
    return Response.json({
      error: error instanceof Error ? error.message : 'Invalid tool request',
    }, { status })
  }
}

async function enforceRateLimit(
  env: ToolGatewayEnv,
  subject: string,
  capability: typeof SEARCH_SCOPE | typeof SCRAPE_SCOPE,
  startedAt: number,
): Promise<Response | null> {
  const binding = capability === SEARCH_SCOPE ? env.SEARCH_RATE_LIMITER : env.SCRAPE_RATE_LIMITER
  const label = capability === SEARCH_SCOPE ? 'Search' : 'Scrape'
  try {
    if (!binding) throw new Error('Rate limiter is not configured')
    const { success } = await binding.limit({ key: `${subject}:${capability}` })
    if (success) return null
    logRequest(startedAt, { capability, subject, status: 429 })
    return Response.json(
      { error: `${label} rate limit exceeded`, code: 'tool_rate_limited' },
      { status: 429, headers: { 'Retry-After': '60' } },
    )
  } catch {
    logRequest(startedAt, { capability, subject, status: 503 })
    return Response.json({ error: `${label} rate limiter is unavailable` }, { status: 503 })
  }
}

async function proxySearch(
  input: { query: string, count: number },
  env: ToolGatewayEnv,
  fetchImpl: FetchLike,
): Promise<Response> {
  const apiKey = readRequiredEnv(env.ANYSEARCH_API_KEY)
  if (!apiKey) {
    return Response.json({ error: 'Search provider is not configured' }, { status: 503 })
  }

  const upstreamUrl = readRequiredEnv(env.ANYSEARCH_UPSTREAM_URL) ?? DEFAULT_ANYSEARCH_URL
  let upstream: Response
  try {
    upstream = await fetchImpl(new Request(upstreamUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Anysearch-Client': 'storyflow/tool-gateway',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'search',
          arguments: { query: input.query, max_results: input.count },
        },
      }),
      signal: AbortSignal.timeout(30_000),
    }))
  } catch {
    return Response.json({ error: 'Search provider is unavailable' }, { status: 502 })
  }

  if (upstream.status === 401 || upstream.status === 403) {
    return Response.json(
      { error: 'Search provider authentication failed', code: 'upstream_auth_failed' },
      { status: 502 },
    )
  }
  if (!upstream.ok) {
    return Response.json({ error: 'Search provider is unavailable' }, { status: 502 })
  }

  try {
    const data = JSON.parse(await readBoundedText(upstream.body, UPSTREAM_BODY_LIMIT_BYTES)) as AnySearchResponse
    if (data.error) {
      return Response.json({ error: 'Search provider returned an error' }, { status: 502 })
    }
    const text = data.result?.content
      ?.filter(item => item.type === 'text' && item.text)
      .map(item => item.text)
      .join('\n\n')
    if (!text) {
      return Response.json({ error: 'Search provider returned no results' }, { status: 502 })
    }
    return Response.json({
      results: [{ title: 'Web search results', url: '', description: text }],
    })
  } catch {
    return Response.json({ error: 'Search provider returned an invalid response' }, { status: 502 })
  }
}

async function proxyScrape(
  input: { url: string },
  env: ToolGatewayEnv,
  fetchImpl: FetchLike,
): Promise<Response> {
  const apiKey = readRequiredEnv(env.FIRECRAWL_API_KEY)
  if (!apiKey) {
    return Response.json({ error: 'Scrape provider is not configured' }, { status: 503 })
  }

  const upstreamUrl = readRequiredEnv(env.FIRECRAWL_UPSTREAM_URL) ?? DEFAULT_FIRECRAWL_URL
  let upstream: Response
  try {
    upstream = await fetchImpl(new Request(upstreamUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: input.url,
        formats: ['markdown'],
        onlyMainContent: true,
        timeout: 60_000,
      }),
      signal: AbortSignal.timeout(70_000),
    }))
  } catch {
    return Response.json({ error: 'Scrape provider is unavailable' }, { status: 502 })
  }

  if (upstream.status === 401 || upstream.status === 403) {
    return Response.json(
      { error: 'Scrape provider authentication failed', code: 'upstream_auth_failed' },
      { status: 502 },
    )
  }
  if (!upstream.ok) {
    return Response.json({ error: 'Scrape provider is unavailable' }, { status: 502 })
  }

  try {
    const data = JSON.parse(await readBoundedText(upstream.body, UPSTREAM_BODY_LIMIT_BYTES)) as FirecrawlResponse
    const markdown = data.success === true ? data.data?.markdown?.trim() : undefined
    if (!markdown) {
      return Response.json({ error: 'Scrape provider returned no content' }, { status: 502 })
    }
    const metadata = data.data?.metadata
    return Response.json({
      markdown,
      ...(metadata?.title?.trim() ? { title: metadata.title.trim() } : {}),
      url: metadata?.sourceURL?.trim() || metadata?.url?.trim() || input.url,
    })
  } catch {
    return Response.json({ error: 'Scrape provider returned an invalid response' }, { status: 502 })
  }
}

async function readSearchInput(request: Request): Promise<{ query: string, count: number }> {
  const body = await readJsonObject(request)
  const query = typeof body.query === 'string' ? body.query.trim() : ''
  if (!query || query.length > 2_000) {
    throw new SyntaxError('query must contain 1 to 2000 characters')
  }
  const count = body.count === undefined ? 5 : body.count
  if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 10) {
    throw new SyntaxError('count must be an integer from 1 to 10')
  }
  return { query, count: count as number }
}

async function readScrapeInput(request: Request): Promise<{ url: string }> {
  const body = await readJsonObject(request)
  const rawUrl = typeof body.url === 'string' ? body.url.trim() : ''
  if (!rawUrl || rawUrl.length > 4_096) {
    throw new SyntaxError('url must contain 1 to 4096 characters')
  }
  const url = new URL(rawUrl)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SyntaxError('url must use HTTP or HTTPS')
  }
  if (url.username || url.password || isPrivateHostname(url.hostname)) {
    throw new SyntaxError('url must identify a public webpage without credentials')
  }
  return { url: url.toString() }
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('application/json')) {
    throw new SyntaxError('Content-Type must be application/json')
  }
  const value = JSON.parse(await readBoundedText(request.body, REQUEST_BODY_LIMIT_BYTES)) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SyntaxError('Request body must be a JSON object')
  }
  return value as Record<string, unknown>
}

function isPrivateHostname(raw: string): boolean {
  const hostname = raw.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname === 'metadata.google.internal'
    || hostname === '::1'
    || hostname.startsWith('::')
    || hostname.startsWith('fe80:')
    || (hostname.includes(':') && (hostname.startsWith('fc') || hostname.startsWith('fd')))
  ) return true
  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false
  }
  return octets[0] === 0
    || octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
}

async function readBoundedText(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!stream) return ''
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) {
        await reader.cancel('Body size limit exceeded')
        throw new PayloadTooLargeError(`Body exceeds ${Math.floor(limit / 1024)}KB`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(result)
}

async function verifyToolGatewayJwt(
  token: string,
  env: ToolGatewayEnv,
  requiredScope: string,
): Promise<string> {
  const kid = decodeProtectedHeader(token).kid
  if (typeof kid !== 'string' || !kid.trim()) throw new Error('Tool token key id is required')
  const key = [getCurrentKey(env), getPreviousKey(env)].find(candidate => candidate?.id === kid)
  if (!key) throw new Error('Tool token key is unknown')
  const { payload } = await jwtVerify<ToolGatewayJwtPayload>(
    token,
    await importSPKI(key.publicKey, 'ES256'),
    {
      algorithms: ['ES256'],
      issuer: readRequiredEnv(env.STORYFLOW_TOOL_GATEWAY_JWT_ISSUER) ?? DEFAULT_ISSUER,
      audience: readRequiredEnv(env.STORYFLOW_TOOL_GATEWAY_JWT_AUDIENCE) ?? DEFAULT_AUDIENCE,
    },
  )
  const subject = readRequiredEnv(payload.sub)
  if (!subject) throw new Error('Tool token subject is required')
  if (!Array.isArray(payload.scopes) || !payload.scopes.includes(requiredScope)) {
    throw new ForbiddenToolTokenError(`Missing required capability: ${requiredScope}`)
  }
  return subject
}

function getCurrentKey(env: ToolGatewayEnv): { id: string, publicKey: string } | null {
  const publicKey = readRequiredEnv(env.STORYFLOW_TOOL_GATEWAY_JWT_CURRENT_PUBLIC_KEY)
  if (!publicKey) return null
  return {
    id: readRequiredEnv(env.STORYFLOW_TOOL_GATEWAY_JWT_CURRENT_KEY_ID) ?? DEFAULT_CURRENT_KEY_ID,
    publicKey,
  }
}

function getPreviousKey(env: ToolGatewayEnv): { id: string, publicKey: string } | null {
  const id = readRequiredEnv(env.STORYFLOW_TOOL_GATEWAY_JWT_PREVIOUS_KEY_ID)
  const publicKey = readRequiredEnv(env.STORYFLOW_TOOL_GATEWAY_JWT_PREVIOUS_PUBLIC_KEY)
  return id && publicKey ? { id, publicKey } : null
}

async function getReadinessError(env: ToolGatewayEnv): Promise<string | null> {
  const key = getCurrentKey(env)
  if (!key) return 'Tool capability verification is not configured'
  try {
    await importSPKI(key.publicKey, 'ES256')
  } catch {
    return 'Tool capability verification key is invalid'
  }
  if (!readRequiredEnv(env.ANYSEARCH_API_KEY)) return 'Search provider is not configured'
  if (!readRequiredEnv(env.FIRECRAWL_API_KEY)) return 'Scrape provider is not configured'
  if (typeof env.SEARCH_RATE_LIMITER?.limit !== 'function') return 'Search rate limiter is not configured'
  if (typeof env.SCRAPE_RATE_LIMITER?.limit !== 'function') return 'Scrape rate limiter is not configured'
  return null
}

function readBearerToken(header: string | null): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? '')
  return readRequiredEnv(match?.[1])
}

function readRequiredEnv(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function invalidToolAccessTokenResponse(): Response {
  return Response.json(
    { error: 'Invalid tool access token', code: 'tool_access_token_invalid' },
    { status: 401 },
  )
}

function methodNotAllowed(method: string): Response {
  return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: method } })
}

function logRequest(
  startedAt: number,
  details: { capability: string, status: number, subject?: string },
): void {
  console.log(JSON.stringify({
    event: 'tool_gateway_request',
    capability: details.capability,
    status: details.status,
    duration_ms: Date.now() - startedAt,
    ...(details.subject ? { subject: details.subject } : {}),
  }))
}
