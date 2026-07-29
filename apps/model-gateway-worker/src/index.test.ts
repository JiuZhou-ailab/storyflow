// input: Cloudflare Worker requests, signed model access JWTs, and upstream fetch stubs
// output: Regression coverage for NewAPI proxy authorization and credential isolation
// pos: Guards the edge boundary that keeps the NewAPI service key off desktop clients

import { describe, expect, it, spyOn } from 'bun:test'
import { handleRequest } from './index'

const CURRENT_MODEL_KEY_ID = 'model-access-2026-07'
const CURRENT_MODEL_SECRET = 'broker-signing-secret'
const PREVIOUS_MODEL_KEY_ID = 'model-access-2026-06'
const PREVIOUS_MODEL_SECRET = 'previous-broker-signing-secret'

async function signTestJwt(
  secret: string,
  payload: Record<string, unknown> = {},
  kid: string | null = CURRENT_MODEL_KEY_ID,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT', ...(kid ? { kid } : {}) }
  const body = {
    iss: 'storyflow-auth-broker',
    aud: 'storyflow-model-gateway',
    sub: 'neon:neon_user_123',
    scopes: ['model:chat'],
    model_tier: 'standard',
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
    STORYFLOW_GATEWAY_JWT_CURRENT_KEY_ID: CURRENT_MODEL_KEY_ID,
    STORYFLOW_GATEWAY_JWT_CURRENT_SECRET: CURRENT_MODEL_SECRET,
    STORYFLOW_GATEWAY_JWT_PREVIOUS_KEY_ID: PREVIOUS_MODEL_KEY_ID,
    STORYFLOW_GATEWAY_JWT_PREVIOUS_SECRET: PREVIOUS_MODEL_SECRET,
    STORYFLOW_GATEWAY_JWT_AUDIENCE: 'storyflow-model-gateway',
    NEWAPI_API_KEY: 'server-only-newapi-key',
    NEWAPI_UPSTREAM_BASE_URL: 'https://jzapi.duanju.com',
  }
}

describe('model gateway worker', () => {
  it('reports readiness only for the explicit current model key and NewAPI configuration', async () => {
    const ready = await handleRequest(
      new Request('https://model.storyflow.example.com/ready'),
      makeEnv(),
    )
    const legacyOnly = await handleRequest(
      new Request('https://model.storyflow.example.com/ready'),
      {
        ...makeEnv(),
        STORYFLOW_GATEWAY_JWT_CURRENT_SECRET: undefined,
        STORYFLOW_GATEWAY_JWT_SECRET: CURRENT_MODEL_SECRET,
      },
    )

    expect(ready.status).toBe(200)
    expect(await ready.json()).toEqual({ status: 'ready' })
    expect(legacyOnly.status).toBe(503)
    expect(await legacyOnly.json()).toEqual({
      status: 'not_ready',
      code: 'configuration_invalid',
    })
  })

  it('exposes only a GET health endpoint outside the chat route', async () => {
    const health = await handleRequest(
      new Request('https://model.storyflow.example.com/health'),
      makeEnv(),
    )
    const unknown = await handleRequest(
      new Request('https://model.storyflow.example.com/v1/models'),
      makeEnv(),
    )
    const wrongMethod = await handleRequest(
      new Request('https://model.storyflow.example.com/v1/responses'),
      makeEnv(),
    )

    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ status: 'ok' })
    expect(unknown.status).toBe(404)
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get('allow')).toBe('POST')
  })

  it('rejects missing or invalid model access tokens before calling NewAPI', async () => {
    let upstreamCalls = 0
    const fetchStub = async () => {
      upstreamCalls += 1
      return new Response('unexpected')
    }

    const missing = await handleRequest(
      new Request('https://model.storyflow.example.com/v1/responses', {
        method: 'POST',
      }),
      makeEnv(),
      fetchStub,
    )
    const cloudflareHeaderOnly = await handleRequest(
      new Request('https://model.storyflow.example.com/v1/responses', {
        method: 'POST',
        headers: { 'cf-aig-authorization': 'Bearer legacy-token' },
      }),
      makeEnv(),
      fetchStub,
    )
    const invalid = await handleRequest(
      new Request('https://model.storyflow.example.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: 'Bearer invalid-token' },
      }),
      makeEnv(),
      fetchStub,
    )

    expect(missing.status).toBe(401)
    expect(cloudflareHeaderOnly.status).toBe(401)
    expect(invalid.status).toBe(401)
    expect(await missing.json()).toEqual({
      error: 'Invalid model access token',
      code: 'model_access_token_invalid',
    })
    expect(await cloudflareHeaderOnly.json()).toEqual({
      error: 'Invalid model access token',
      code: 'model_access_token_invalid',
    })
    expect(await invalid.json()).toEqual({
      error: 'Invalid model access token',
      code: 'model_access_token_invalid',
    })
    expect(upstreamCalls).toBe(0)
  })

  it('rejects expired, unscoped, and unknown-tier tokens', async () => {
    const now = Math.floor(Date.now() / 1000)
    const expiredToken = await signTestJwt('broker-signing-secret', { exp: now - 1 })
    const unscopedToken = await signTestJwt('broker-signing-secret', { scopes: ['profile:read'] })
    const unknownTierToken = await signTestJwt('broker-signing-secret', { model_tier: 'admin' })

    const requestWith = (token: string) => new Request(
      'https://model.storyflow.example.com/v1/responses',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      },
    )

    const expired = await handleRequest(requestWith(expiredToken), makeEnv())
    const unscoped = await handleRequest(requestWith(unscopedToken), makeEnv())
    const unknownTier = await handleRequest(requestWith(unknownTierToken), makeEnv())

    expect(expired.status).toBe(401)
    expect(await expired.json()).toEqual({
      error: 'Invalid model access token',
      code: 'model_access_token_invalid',
    })
    expect(unscoped.status).toBe(403)
    expect(unknownTier.status).toBe(403)
  })

  it('accepts current and previous keyed tokens but rejects missing or unknown key IDs', async () => {
    const requestWith = (token: string) => new Request(
      'https://model.storyflow.example.com/v1/responses',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      },
    )
    const fetchStub = async () => Response.json({ ok: true })

    const current = await handleRequest(
      requestWith(await signTestJwt(CURRENT_MODEL_SECRET)),
      makeEnv(),
      fetchStub,
    )
    const previous = await handleRequest(
      requestWith(await signTestJwt(PREVIOUS_MODEL_SECRET, {}, PREVIOUS_MODEL_KEY_ID)),
      makeEnv(),
      fetchStub,
    )
    const noKid = await handleRequest(
      requestWith(await signTestJwt(CURRENT_MODEL_SECRET, {}, null)),
      makeEnv(),
      fetchStub,
    )
    const unknown = await handleRequest(
      requestWith(await signTestJwt(CURRENT_MODEL_SECRET, {}, 'unknown-key')),
      makeEnv(),
      fetchStub,
    )

    expect(current.status).toBe(200)
    expect(previous.status).toBe(200)
    expect(noKid.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(await unknown.json()).toEqual({
      error: 'Invalid model access token',
      code: 'model_access_token_invalid',
    })
  })

  it('maps standard and pro tokens to the same server-side NewAPI credential', async () => {
    for (const tier of ['standard', 'pro'] as const) {
      const token = await signTestJwt('broker-signing-secret', { model_tier: tier })
      let upstreamRequest: Request | null = null

      const response = await handleRequest(
        new Request('https://model.storyflow.example.com/v1/responses?debug=1', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
            Cookie: 'must-not-forward=1',
            'X-Untrusted-Header': 'must-not-forward',
          },
          body: JSON.stringify({ model: 'gpt-5.5', input: [], stream: true }),
        }),
        makeEnv(),
        async (request) => {
          upstreamRequest = request
          return new Response('data: {"ok":true}\n\n', {
            headers: { 'Content-Type': 'text/event-stream' },
          })
        },
      )

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/event-stream')
      expect(await response.text()).toBe('data: {"ok":true}\n\n')
      expect(upstreamRequest?.url).toBe('https://jzapi.duanju.com/v1/responses?debug=1')
      expect(upstreamRequest?.headers.get('authorization')).toBe('Bearer server-only-newapi-key')
      expect(upstreamRequest?.headers.get('accept')).toBe('text/event-stream')
      expect(upstreamRequest?.headers.get('content-type')).toBe('application/json')
      expect(upstreamRequest?.headers.get('cookie')).toBeNull()
      expect(upstreamRequest?.headers.get('x-untrusted-header')).toBeNull()
    }
  })

  it('keeps the legacy Chat Completions route for older desktop releases', async () => {
    const token = await signTestJwt(CURRENT_MODEL_SECRET)
    let upstreamUrl = ''

    const response = await handleRequest(
      new Request('https://model.storyflow.example.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ model: 'gpt-5.5', messages: [] }),
      }),
      makeEnv(),
      async (request) => {
        upstreamUrl = request.url
        return Response.json({ ok: true })
      },
    )

    expect(response.status).toBe(200)
    expect(upstreamUrl).toBe('https://jzapi.duanju.com/v1/chat/completions')
  })

  it('fails closed when NewAPI configuration or the upstream is unavailable', async () => {
    const token = await signTestJwt('broker-signing-secret')
    const requestWithToken = () => new Request(
      'https://model.storyflow.example.com/v1/responses',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      },
    )

    const missingConfig = await handleRequest(
      requestWithToken(),
      { ...makeEnv(), NEWAPI_API_KEY: undefined },
    )
    const unavailable = await handleRequest(
      requestWithToken(),
      makeEnv(),
      async () => {
        throw new Error('network down')
      },
    )

    expect(missingConfig.status).toBe(503)
    expect(unavailable.status).toBe(502)
  })

  it('does not misclassify upstream service authentication failures as client token failures', async () => {
    const token = await signTestJwt(CURRENT_MODEL_SECRET)
    const response = await handleRequest(
      new Request('https://model.storyflow.example.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }),
      makeEnv(),
      async () => Response.json(
        { error: 'server credential rejected' },
        { status: 401 },
      ),
    )

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      error: 'Model provider authentication failed',
      code: 'upstream_auth_failed',
    })
  })

  it('normalizes an empty upstream 400 into a structured gateway failure', async () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    try {
      const token = await signTestJwt(CURRENT_MODEL_SECRET)
      const response = await handleRequest(
        new Request('https://model.storyflow.example.com/v1/responses', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }),
        makeEnv(),
        async () => new Response(null, {
          status: 400,
          headers: { 'cf-ray': 'empty-400-ray' },
        }),
      )

      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({
        error: {
          message: 'Model provider rejected the request without an error body',
          type: 'upstream_error',
          code: 'upstream_empty_response',
        },
      })
      expect(errorSpy.mock.calls[0]?.[0]).toMatchObject({
        stage: 'upstream',
        upstream_status: 400,
        upstream_ray: 'empty-400-ray',
        error: 'empty_response_body',
      })
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('logs upstream failures with correlation fields but without request content or credentials', async () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    try {
      const token = await signTestJwt(CURRENT_MODEL_SECRET, {
        sub: 'feishu:ou_debug',
        user_name: '飞书用户',
      })
      const response = await handleRequest(
        new Request('https://model.storyflow.example.com/v1/responses', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'cf-ray': 'incoming-request-ray',
          },
          body: JSON.stringify({
            model: 'gpt-5.5',
            input: [{ role: 'user', content: 'private prompt content' }],
          }),
        }),
        makeEnv(),
        async () => new Response('error code: 520', {
          status: 520,
          headers: { 'cf-ray': 'upstream-request-ray' },
        }),
      )

      expect(response.status).toBe(520)
      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(errorSpy.mock.calls[0]?.[0]).toMatchObject({
        stage: 'upstream',
        upstream_status: 520,
        upstream_ray: 'upstream-request-ray',
        user: 'feishu:ou_debug',
        user_name: '飞书用户',
        duration_ms: expect.any(Number),
      })
      expect(Object.keys(errorSpy.mock.calls[0]?.[0] as object).sort()).toEqual([
        'duration_ms',
        'stage',
        'upstream_ray',
        'upstream_status',
        'user',
        'user_name',
      ])

      const logged = JSON.stringify(errorSpy.mock.calls[0]?.[0])
      expect(logged).not.toContain('private prompt content')
      expect(logged).not.toContain(CURRENT_MODEL_SECRET)
      expect(logged).not.toContain('server-only-newapi-key')
    } finally {
      errorSpy.mockRestore()
    }
  })
})
