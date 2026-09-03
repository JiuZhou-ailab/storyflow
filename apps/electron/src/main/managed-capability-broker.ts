// input: Storyflow client-auth state plus managed model and tool capability refresh functions
// output: Loopback-only, operation-scoped access for trusted local Agent and CLI processes
// pos: Host projection from desktop login ownership to managed child-process capabilities

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

export const MODEL_ACCESS_BROKER_URL_ENV = 'STORYFLOW_MODEL_ACCESS_BROKER_URL'
export const MODEL_ACCESS_BROKER_TOKEN_ENV = 'STORYFLOW_MODEL_ACCESS_BROKER_TOKEN'
export const TOOL_BROKER_URL_ENV = 'STORYFLOW_TOOL_BROKER_URL'
export const TOOL_BROKER_TOKEN_ENV = 'STORYFLOW_TOOL_BROKER_TOKEN'
export const DEFAULT_TOOL_GATEWAY_BASE_URL = 'https://storyflow-tools.zjding.com'

type BrokerEnvKey =
  | typeof MODEL_ACCESS_BROKER_URL_ENV
  | typeof MODEL_ACCESS_BROKER_TOKEN_ENV
  | typeof TOOL_BROKER_URL_ENV
  | typeof TOOL_BROKER_TOKEN_ENV

export interface ManagedCapabilityBroker {
  env: Record<BrokerEnvKey, string>
  close(): Promise<void>
}

interface ManagedCapabilityBrokerOptions {
  modelGatewayBaseUrl: string
  toolGatewayBaseUrl: string
  isAuthenticated(): boolean
  ensureModelAccessToken(options?: { force?: boolean }): Promise<{ token: string }>
  ensureToolAccessToken(options?: { force?: boolean }): Promise<{ token: string }>
  fetchImpl?: (request: Request) => Promise<Response>
}

class PayloadTooLargeError extends Error {}

export async function startManagedCapabilityBroker(
  options: ManagedCapabilityBrokerOptions,
): Promise<ManagedCapabilityBroker> {
  const modelGatewayBaseUrl = normalizeGatewayBaseUrl(options.modelGatewayBaseUrl)
  const toolGatewayBaseUrl = normalizeGatewayBaseUrl(options.toolGatewayBaseUrl)
  const capability = randomBytes(32).toString('base64url')
  const server = createServer((request, response) => {
    void handleRequest(
      request,
      response,
      capability,
      modelGatewayBaseUrl,
      toolGatewayBaseUrl,
      options,
    )
  })
  server.on('clientError', (_error, socket) => socket.destroy())

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      resolve()
    })
  })
  server.unref()

  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Managed capability broker did not bind a TCP port')
  }
  const origin = `http://127.0.0.1:${address.port}`

  return {
    env: {
      [MODEL_ACCESS_BROKER_URL_ENV]: `${origin}/v1/model-access-token`,
      [MODEL_ACCESS_BROKER_TOKEN_ENV]: capability,
      [TOOL_BROKER_URL_ENV]: `${origin}/v1/tools`,
      [TOOL_BROKER_TOKEN_ENV]: capability,
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
      // In-flight upstream proxies can take up to 80s; the broker dies with
      // the app, so cut them rather than let a quit wait on a remote gateway.
      server.closeAllConnections()
    }),
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  capability: string,
  modelGatewayBaseUrl: string,
  toolGatewayBaseUrl: string,
  options: ManagedCapabilityBrokerOptions,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (
    url.pathname !== '/v1/model-access-token'
    && url.pathname !== '/v1/tools/search'
    && url.pathname !== '/v1/tools/scrape'
  ) {
    sendJson(response, 404, { error: 'Unknown managed capability route' })
    return
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    sendJson(response, 405, { error: 'Method not allowed' })
    return
  }
  if (!matchesCapability(request.headers.authorization, capability)) {
    sendJson(response, 403, {
      error: 'Invalid local capability',
      code: 'local_capability_invalid',
    })
    return
  }
  if (!options.isAuthenticated()) {
    sendJson(response, 401, {
      error: 'Storyflow login is required',
      code: 'storyflow_login_required',
    })
    return
  }

  try {
    const body = await readRequestJson(request)
    if (url.pathname === '/v1/model-access-token') {
      const { token } = await options.ensureModelAccessToken({ force: body.forceRefresh === true })
      sendJson(response, 200, {
        gatewayBaseUrl: modelGatewayBaseUrl,
        modelAccessToken: token,
      })
      return
    }
    await proxyToolOperation(
      response,
      body,
      toolGatewayBaseUrl,
      options,
      url.pathname === '/v1/tools/search' ? 'search' : 'scrape',
    )
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      sendJson(response, 413, { error: error.message })
      return
    }
    if (error instanceof SyntaxError) {
      sendJson(response, 400, { error: 'Request body must be valid JSON' })
      return
    }
    sendJson(response, 503, {
      error: 'Managed capability is unavailable',
      code: 'managed_capability_unavailable',
    })
  }
}

async function proxyToolOperation(
  response: ServerResponse,
  body: Record<string, unknown>,
  toolGatewayBaseUrl: string,
  options: ManagedCapabilityBrokerOptions,
  operation: 'search' | 'scrape',
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch
  const callGateway = async (force: boolean): Promise<Response> => {
    const { token } = await options.ensureToolAccessToken({ force })
    return fetchImpl(new Request(`${toolGatewayBaseUrl}/v1/${operation}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(operation === 'scrape' ? 80_000 : 35_000),
    }))
  }

  let upstream = await callGateway(false)
  if (upstream.status === 401 || upstream.status === 403) {
    upstream = await callGateway(true)
  }
  const content = await readResponseBuffer(upstream.body, 1024 * 1024)
  response.writeHead(upstream.status, {
    'Cache-Control': 'no-store',
    'Content-Type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
  })
  response.end(content)
}

async function readResponseBuffer(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Buffer> {
  if (!body) return Buffer.alloc(0)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return Buffer.concat(chunks, bytes)
      bytes += value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel('Tool response exceeds 1MB')
        throw new PayloadTooLargeError('Tool response exceeds 1MB')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
}

async function readRequestJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > 16 * 1024) throw new PayloadTooLargeError('Request body exceeds 16KB')
    chunks.push(buffer)
  }
  if (bytes === 0) return {}
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SyntaxError('Request body must be an object')
  }
  return value as Record<string, unknown>
}

function matchesCapability(header: string | undefined, expected: string): boolean {
  const match = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? '')
  if (!match?.[1]) return false
  const actualBytes = Buffer.from(match[1])
  const expectedBytes = Buffer.from(expected)
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
}

function normalizeGatewayBaseUrl(raw: string): string {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Managed gateway must be an HTTPS origin without credentials')
  }
  return url.origin
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(body))
}
