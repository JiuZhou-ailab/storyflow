// input: Desktop auth broker HTTP requests and mocked Feishu/Neon identity providers
// output: Regression coverage for broker-issued managed model gateway JWTs
// pos: Tests the deployed HTTPS auth broker used by packaged desktop client auth
import { describe, expect, it } from 'bun:test'
import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose'
import { handleRequest } from './index'

function makeEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    CRAFT_WEBUI_FEISHU_APP_ID: 'cli_test',
    CRAFT_WEBUI_FEISHU_APP_SECRET: 'feishu-secret',
    CRAFT_WEBUI_FEISHU_ALLOW_ALL_USERS: 'true',
    CRAFT_WEBUI_NEON_AUTH_BASE_URL: 'https://ep-test.neonauth.aws.neon.build/neondb/auth',
    CRAFT_WEBUI_NEON_AUTH_USERNAME_EMAIL_DOMAIN: 'users.craft.invalid',
    CLIENT_GATEWAY_JWT_SECRET: 'broker-signing-secret',
    CLIENT_GATEWAY_CONNECTION_SLUGS: 'wangsu-default,xiaomi-default',
    ...overrides,
  }
}

describe('auth broker worker', () => {
  it('exposes public Feishu config without server secrets', async () => {
    const res = await handleRequest(
      new Request('https://auth.example.com/api/client-auth/feishu/config'),
      makeEnv(),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      enabled: true,
      appId: 'cli_test',
    })
  })

  it('exchanges Feishu OAuth codes and returns a scoped gateway JWT', async () => {
    const fetchCalls: Array<{ url: string, init?: RequestInit }> = []
    const res = await handleRequest(
      new Request('https://auth.example.com/api/client-auth/feishu/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'desktop-code',
          redirectUri: 'http://localhost:6477/callback',
          codeVerifier: 'desktop-verifier',
        }),
      }),
      makeEnv(),
      async (input, init) => {
        fetchCalls.push({ url: input.toString(), init })
        if (input.toString().endsWith('/open-apis/authen/v2/oauth/token')) {
          return Response.json({ access_token: 'feishu-access-token' })
        }
        if (input.toString().endsWith('/open-apis/authen/v1/user_info')) {
          return Response.json({
            data: {
              open_id: 'ou_desktop',
              tenant_key: 'tenant_external',
              enterprise_email: 'Desktop.User@Example.com',
              name: 'Desktop User',
            },
          })
        }
        return Response.json({ error: 'unexpected' }, { status: 500 })
      },
    )

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, any>
    expect(body.ok).toBe(true)
    expect(body.user).toEqual({
      provider: 'feishu',
      userId: 'ou_desktop',
      email: 'desktop.user@example.com',
      name: 'Desktop User',
    })

    const { payload } = await jwtVerify(
      body.gatewayToken,
      new TextEncoder().encode('broker-signing-secret'),
      {
        audience: 'storyflow-model-gateway',
        issuer: 'storyflow-auth-broker',
      },
    )
    expect(payload.sub).toBe('feishu:ou_desktop')
    expect(payload.scopes).toEqual(['model:chat'])
    expect(payload.connections).toEqual(['wangsu-default', 'xiaomi-default'])

    const tokenCall = fetchCalls[0]
    expect(tokenCall?.init?.method).toBe('POST')
    expect(JSON.parse(tokenCall?.init?.body as string)).toMatchObject({
      client_id: 'cli_test',
      client_secret: 'feishu-secret',
      code: 'desktop-code',
      redirect_uri: 'http://localhost:6477/callback',
      code_verifier: 'desktop-verifier',
    })
  })

  it('exchanges verified Neon Auth JWTs for a managed gateway JWT', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    const publicJwk = await exportJWK(publicKey)
    publicJwk.kid = 'test-key'
    const token = await new SignJWT({
      email: 'Neon.User@Example.com',
      emailVerified: true,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer('https://ep-test.neonauth.aws.neon.build')
      .setAudience('https://ep-test.neonauth.aws.neon.build')
      .setSubject('neon_user_123')
      .setExpirationTime('5m')
      .sign(privateKey)

    const res = await handleRequest(
      new Request('https://auth.example.com/api/client-auth/neon/exchange', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }),
      makeEnv(),
      async (input) => {
        if (input.toString().endsWith('/.well-known/jwks.json')) {
          return Response.json({ keys: [publicJwk] })
        }
        return Response.json({ error: 'unexpected' }, { status: 500 })
      },
    )

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, any>
    expect(body.user).toEqual({
      provider: 'neon',
      userId: 'neon_user_123',
      email: 'neon.user@example.com',
      emailVerified: true,
    })

    const { payload } = await jwtVerify(
      body.gatewayToken,
      new TextEncoder().encode('broker-signing-secret'),
      {
        audience: 'storyflow-model-gateway',
        issuer: 'storyflow-auth-broker',
      },
    )
    expect(payload.sub).toBe('neon:neon_user_123')
    expect(payload.provider).toBe('neon')
  })
})
