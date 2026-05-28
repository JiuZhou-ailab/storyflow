// input: Cloudflare Worker requests, signed desktop gateway JWTs, and upstream fetch stubs
// output: Regression coverage for the managed model gateway proxy contract
// pos: Tests the edge boundary that keeps provider credentials off the desktop client
import { describe, expect, it } from 'bun:test'
import { handleRequest } from './index'

async function signTestJwt(
  secret: string,
  payload: Record<string, unknown> = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT' }
  const body = {
    iss: 'storyflow-auth-broker',
    aud: 'storyflow-model-gateway',
    sub: 'neon_user_123',
    scopes: ['model:chat'],
    exp: now + 60,
    iat: now,
    ...payload,
  }
  const signingInput = `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(body)}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signingInput),
  )
  return `${signingInput}.${base64UrlEncodeBytes(new Uint8Array(signature))}`
}

function base64UrlEncodeJson(value: unknown): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(JSON.stringify(value)))
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function makeEnv() {
  return {
    STORYFLOW_GATEWAY_JWT_SECRET: 'broker-signing-secret',
    STORYFLOW_GATEWAY_JWT_AUDIENCE: 'storyflow-model-gateway',
    CLOUDFLARE_AI_GATEWAY_TOKEN: 'cfut-upstream-token',
    WANGSU_UPSTREAM_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/account/default/custom-wangsu',
    XIAOMI_UPSTREAM_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/account/default/custom-xiaomi',
  }
}

describe('model gateway worker', () => {
  it('rejects requests without a desktop gateway bearer token', async () => {
    const res = await handleRequest(
      new Request('https://model-gateway.example.com/wangsu/v1/chat/completions', {
        method: 'POST',
      }),
      makeEnv(),
      async () => new Response('unexpected'),
    )

    expect(res.status).toBe(401)
  })

  it('rejects invalid desktop gateway JWTs before reaching Cloudflare AI Gateway', async () => {
    let upstreamCalled = false

    const res = await handleRequest(
      new Request('https://model-gateway.example.com/wangsu/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer invalid-token',
        },
      }),
      makeEnv(),
      async () => {
        upstreamCalled = true
        return new Response('unexpected')
      },
    )

    expect(res.status).toBe(401)
    expect(upstreamCalled).toBe(false)
  })

  it('forwards valid requests with the server-side Cloudflare AI Gateway credential', async () => {
    const token = await signTestJwt('broker-signing-secret')
    let upstreamRequest: Request | null = null

    const res = await handleRequest(
      new Request('https://model-gateway.example.com/wangsu/v1/chat/completions?debug=1', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'gemini-3.5-flash', messages: [] }),
      }),
      makeEnv(),
      async (request) => {
        upstreamRequest = request
        return Response.json({ ok: true })
      },
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(upstreamRequest).toBeTruthy()
    expect(upstreamRequest?.url).toBe('https://gateway.ai.cloudflare.com/v1/account/default/custom-wangsu/v1/chat/completions?debug=1')
    expect(upstreamRequest?.headers.get('authorization')).toBeNull()
    expect(upstreamRequest?.headers.get('cf-aig-authorization')).toBe('Bearer cfut-upstream-token')
    expect(await upstreamRequest?.json()).toEqual({ model: 'gemini-3.5-flash', messages: [] })
  })

  it('accepts broker JWTs from the Cloudflare provider header and replaces it upstream', async () => {
    const token = await signTestJwt('broker-signing-secret')
    let upstreamRequest: Request | null = null

    const res = await handleRequest(
      new Request('https://model-gateway.example.com/wangsu/v1/chat/completions', {
        method: 'POST',
        headers: {
          'cf-aig-authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'gemini-3.5-flash', messages: [] }),
      }),
      makeEnv(),
      async (request) => {
        upstreamRequest = request
        return Response.json({ ok: true })
      },
    )

    expect(res.status).toBe(200)
    expect(upstreamRequest?.headers.get('authorization')).toBeNull()
    expect(upstreamRequest?.headers.get('cf-aig-authorization')).toBe('Bearer cfut-upstream-token')
  })

  it('rejects tokens without the model chat scope', async () => {
    const token = await signTestJwt('broker-signing-secret', { scopes: ['profile:read'] })

    const res = await handleRequest(
      new Request('https://model-gateway.example.com/xiaomi/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
      makeEnv(),
      async () => new Response('unexpected'),
    )

    expect(res.status).toBe(403)
  })

  it('rejects valid tokens that are not authorized for the requested managed route', async () => {
    const token = await signTestJwt('broker-signing-secret', {
      connections: ['xiaomi-default'],
    })

    const res = await handleRequest(
      new Request('https://model-gateway.example.com/wangsu/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
      makeEnv(),
      async () => new Response('unexpected'),
    )

    expect(res.status).toBe(403)
  })
})
