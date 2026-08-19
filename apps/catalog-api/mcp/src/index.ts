// input: Private-network or bearer-authenticated MCP requests and the Storyflow Catalog HTTP API
// output: Five fixed read-only Catalog tools over Streamable HTTP
// pos: Protocol adapter that keeps origin credentials server-side and never exposes SQL

import { timingSafeEqual } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod/v4'

const MAX_REQUEST_BYTES = 64 * 1024
const MAX_CATALOG_RESPONSE_BYTES = 2 * 1024 * 1024
const CATALOG_TIMEOUT_MS = 20_000
const SOURCES = ['hongguo', 'goodshort', 'reelshort', 'dataeye'] as const
const VIDEO_SOURCES = ['hongguo', 'dramabox', 'goodshort', 'reelshort', 'reelshort-app', 'dataeye'] as const
const RANKING_KINDS = ['current_hot', 'platform_daily', 'weekly_hot', 'weekly_rank'] as const

export interface Settings {
  catalogApiUrl: URL
  catalogOriginToken: string
  mcpAuth: { mode: 'private-network' } | { mode: 'bearer'; token: string }
  host: string
  port: number
}

export function loadSettings(env: Record<string, string | undefined> = process.env): Settings {
  const catalogApiUrl = new URL(required(env, 'CATALOG_API_URL'))
  if (!['http:', 'https:'].includes(catalogApiUrl.protocol)) {
    throw new Error('CATALOG_API_URL must use HTTP or HTTPS')
  }
  const catalogOriginToken = required(env, 'CATALOG_ORIGIN_TOKEN')
  const mcpAuthMode = required(env, 'MCP_AUTH_MODE')
  if (catalogOriginToken.length < 32) throw new Error('CATALOG_ORIGIN_TOKEN must contain at least 32 characters')
  if (mcpAuthMode !== 'private-network' && mcpAuthMode !== 'bearer') {
    throw new Error('MCP_AUTH_MODE must be private-network or bearer')
  }
  const mcpAuth = mcpAuthMode === 'bearer'
    ? { mode: 'bearer' as const, token: required(env, 'MCP_BEARER_TOKEN') }
    : { mode: 'private-network' as const }
  if (mcpAuth.mode === 'bearer' && mcpAuth.token.length < 32) {
    throw new Error('MCP_BEARER_TOKEN must contain at least 32 characters')
  }

  const port = Number(env.PORT ?? 8789)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer from 1 to 65535')
  }
  return {
    catalogApiUrl,
    catalogOriginToken,
    mcpAuth,
    host: env.HOST?.trim() || '0.0.0.0',
    port,
  }
}

export function createMcpServer(
  settings: Settings,
  fetchImpl: typeof fetch = fetch,
): McpServer {
  const server = new McpServer({ name: 'storyflow-catalog', version: '1.0.0' })
  const catalog = (path: string, query?: Record<string, string | number | boolean | undefined>) =>
    fetchCatalog(settings, fetchImpl, path, query)
  const readOnly = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  } as const

  server.registerTool('catalog_sources', {
    title: 'Catalog Sources',
    description: 'List supported short-drama ranking and video-asset sources.',
    annotations: readOnly,
  }, async () => toolResult(() => catalog('/v2/catalog/sources')))

  server.registerTool('video_assets', {
    title: 'Video Assets',
    description: 'Search one source for bounded episode or creative video assets. Direct files include downloadUrl; HLS assets use playbackUrl with downloadMethod=hls_remux.',
    inputSchema: {
      source: z.enum(VIDEO_SOURCES),
      seriesId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
      query: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).max(1_000_000).default(0),
    },
    annotations: readOnly,
  }, async ({ source, seriesId, query, limit, offset }) => toolResult(() =>
    catalog('/v2/video-assets', {
      source,
      seriesId,
      q: query,
      limit,
      offset,
    })))

  server.registerTool('ranking_snapshots', {
    title: 'Ranking Snapshots',
    description: 'List available ranking snapshots for one source or all sources.',
    inputSchema: {
      source: z.enum([...SOURCES, 'all']).default('all'),
      rankingKind: z.enum(RANKING_KINDS).optional(),
    },
    annotations: readOnly,
  }, async ({ source, rankingKind }) => toolResult(() => catalog('/v2/ranking-snapshots', {
    source,
    rankingKind,
  })))

  server.registerTool('rankings', {
    title: 'Catalog Rankings',
    description: 'Query source-grouped rankings with bounded search, snapshot, and media-readiness filters.',
    inputSchema: {
      source: z.enum([...SOURCES, 'all']).default('all'),
      rankingKind: z.enum(RANKING_KINDS).optional(),
      snapshot: z.string().min(1).max(96).default('latest'),
      query: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(100).default(20),
      conversionReady: z.enum(['any', 'true', 'false']).default('any'),
    },
    annotations: readOnly,
  }, async ({ source, rankingKind, snapshot, query, limit, conversionReady }) => toolResult(() =>
    catalog('/v2/rankings', {
      source,
      rankingKind,
      snapshot,
      q: query,
      limit,
      conversionReady,
    })))

  server.registerTool('series_manifest', {
    title: 'Series Manifest',
    description: 'Get a normalized series manifest; episode URLs are returned only when the source is complete.',
    inputSchema: {
      source: z.enum(SOURCES),
      sourceId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    },
    annotations: readOnly,
  }, async ({ source, sourceId }) => toolResult(() =>
    catalog(`/v2/series/${source}/${encodeURIComponent(sourceId)}/manifest`)))

  return server
}

export function createFetchHandler(
  settings: Settings,
  fetchImpl: typeof fetch = fetch,
): (request: Request) => Promise<Response> {
  return async request => {
    const startedAt = Date.now()
    const path = new URL(request.url).pathname
    let response: Response
    try {
      if (path === '/health') {
        response = request.method === 'GET'
          ? Response.json({ status: 'ok' })
          : methodNotAllowed('GET')
      } else if (
        (path === '/ready' || path === '/mcp')
        && settings.mcpAuth.mode === 'bearer'
        && !isAuthorized(request, settings.mcpAuth.token)
      ) {
        response = invalidMcpAccessToken()
      } else if (path === '/ready') {
        if (request.method !== 'GET') return methodNotAllowed('GET')
        try {
          await fetchCatalog(settings, fetchImpl, '/ready')
          response = Response.json({ status: 'ready' })
        } catch {
          response = Response.json({ status: 'not_ready' }, { status: 503 })
        }
      } else if (path !== '/mcp') {
        response = Response.json({ error: 'not_found' }, { status: 404 })
      } else if (request.method !== 'POST') {
        response = methodNotAllowed('POST')
      } else {
        const parsedBody = await readMcpBody(request)
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        })
        const server = createMcpServer(settings, fetchImpl)
        try {
          await server.connect(transport)
          response = await transport.handleRequest(request, { parsedBody })
        } finally {
          await transport.close()
          await server.close()
        }
      }
    } catch (error) {
      if (error instanceof HttpError) {
        response = jsonRpcError(error.status, error.code, error.message)
      } else {
        console.error('catalog-mcp: request_failed')
        response = jsonRpcError(500, -32603, 'Internal server error')
      }
    }
    console.log(`catalog-mcp: method=${request.method} path=${path} status=${response.status} duration_ms=${Date.now() - startedAt}`)
    return response
  }
}

async function fetchCatalog(
  settings: Settings,
  fetchImpl: typeof fetch,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): Promise<unknown> {
  const url = new URL(path, settings.catalogApiUrl)
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(name, String(value))
  }
  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: { 'X-Storyflow-Origin-Token': settings.catalogOriginToken },
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    })
  } catch {
    throw new Error('Catalog service is unavailable')
  }
  const text = await readBoundedText(response, MAX_CATALOG_RESPONSE_BYTES)
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error('Catalog service returned an invalid response')
  }
  if (!response.ok) {
    const code = body && typeof body === 'object' && 'error' in body
      ? String((body as { error: unknown }).error).slice(0, 120)
      : 'request_failed'
    throw new Error(`Catalog request failed (${response.status}: ${code})`)
  }
  return body
}

async function toolResult(operation: () => Promise<unknown>) {
  try {
    const body = await operation()
    return { content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }] }
  } catch (error) {
    return {
      isError: true,
      content: [{
        type: 'text' as const,
        text: error instanceof Error ? error.message : 'Catalog request failed',
      }],
    }
  }
}

function isAuthorized(request: Request, expected: string): boolean {
  const header = request.headers.get('authorization') ?? ''
  const supplied = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const suppliedBytes = Buffer.from(supplied)
  const expectedBytes = Buffer.from(expected)
  return suppliedBytes.length === expectedBytes.length
    && timingSafeEqual(suppliedBytes, expectedBytes)
}

async function readMcpBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    throw new HttpError(413, -32000, 'Request body is too large')
  }
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
    throw new HttpError(413, -32000, 'Request body is too large')
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, -32700, 'Parse error')
  }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('Catalog response is too large')
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('Catalog response is too large')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function methodNotAllowed(method: string): Response {
  return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: { Allow: method } })
}

function invalidMcpAccessToken(): Response {
  return Response.json(
    { error: 'invalid_mcp_access_token' },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
  )
}

function jsonRpcError(status: number, code: number, message: string): Response {
  return Response.json({ jsonrpc: '2.0', error: { code, message }, id: null }, { status })
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: number,
    message: string,
  ) {
    super(message)
  }
}

if (import.meta.main) {
  const settings = loadSettings()
  Bun.serve({
    hostname: settings.host,
    port: settings.port,
    maxRequestBodySize: MAX_REQUEST_BYTES,
    fetch: createFetchHandler(settings),
  })
  console.log(`catalog-mcp: listening on ${settings.host}:${settings.port}`)
}
