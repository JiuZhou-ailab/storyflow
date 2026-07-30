// input: Storyflow client-auth state and managed model-token refresh capability
// output: Loopback-only short-lived model access for trusted local CLI processes
// pos: Narrow bridge from desktop login ownership to managed CLI model calls

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

export const MODEL_ACCESS_BROKER_URL_ENV = 'STORYFLOW_MODEL_ACCESS_BROKER_URL'
export const MODEL_ACCESS_BROKER_TOKEN_ENV = 'STORYFLOW_MODEL_ACCESS_BROKER_TOKEN'

export interface ManagedModelCliBroker {
  env: Record<typeof MODEL_ACCESS_BROKER_URL_ENV | typeof MODEL_ACCESS_BROKER_TOKEN_ENV, string>
  close(): Promise<void>
}

interface ManagedModelCliBrokerOptions {
  gatewayBaseUrl: string
  isAuthenticated(): boolean
  ensureModelAccessToken(options?: { force?: boolean }): Promise<{ token: string }>
}

class PayloadTooLargeError extends Error {}

export async function startManagedModelCliBroker(
  options: ManagedModelCliBrokerOptions,
): Promise<ManagedModelCliBroker> {
  const gatewayBaseUrl = normalizeGatewayBaseUrl(options.gatewayBaseUrl)
  const capability = randomBytes(32).toString('base64url')
  const server = createServer((request, response) => {
    void handleRequest(request, response, capability, gatewayBaseUrl, options)
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
    throw new Error('Managed model CLI broker did not bind a TCP port')
  }

  return {
    env: {
      [MODEL_ACCESS_BROKER_URL_ENV]: `http://127.0.0.1:${address.port}/v1/model-access-token`,
      [MODEL_ACCESS_BROKER_TOKEN_ENV]: capability,
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  capability: string,
  gatewayBaseUrl: string,
  options: ManagedModelCliBrokerOptions,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (url.pathname !== '/v1/model-access-token') {
    sendJson(response, 404, { error: 'Unknown managed model broker route' })
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
    const forceRefresh = body.forceRefresh === true
    const { token } = await options.ensureModelAccessToken({ force: forceRefresh })
    sendJson(response, 200, {
      gatewayBaseUrl,
      modelAccessToken: token,
    })
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
      error: 'Managed model access is unavailable',
      code: 'model_access_unavailable',
    })
  }
}

async function readRequestJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > 4_096) throw new PayloadTooLargeError('Request body exceeds 4KB')
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
    throw new Error('Managed model gateway must be an HTTPS origin without credentials')
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
