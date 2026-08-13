// input: Desktop auth broker HTTP requests and mocked Feishu/Neon identity providers
// output: Regression coverage for login exchanges, company identity, and renewable scoped capabilities
// pos: Tests the deployed HTTPS auth broker used by packaged desktop client auth
import { describe, expect, it } from 'bun:test'
import { decodeProtectedHeader, exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose'
import { handleRequest } from './index'

const CLIENT_SESSION_SECRET = 'client-session-secret'
const MODEL_ACCESS_SECRET = 'broker-signing-secret'
const CLIENT_SESSION_KEY_ID = 'client-session-2026-07'
const MODEL_ACCESS_KEY_ID = 'model-access-2026-07'
const MARKET_SECRET = 'skills-market-secret'
const MARKET_KEY_ID = 'skills-market-2026-08'
const PREVIOUS_CLIENT_SESSION_SECRET = 'previous-client-session-secret'
const PREVIOUS_CLIENT_SESSION_KEY_ID = 'client-session-2026-06'

function makeEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    CRAFT_WEBUI_FEISHU_APP_ID: 'cli_test',
    CRAFT_WEBUI_FEISHU_APP_SECRET: 'feishu-secret',
    CRAFT_WEBUI_FEISHU_ALLOW_ALL_USERS: 'true',
    CRAFT_WEBUI_NEON_AUTH_BASE_URL: 'https://ep-test.neonauth.aws.neon.build/neondb/auth',
    CRAFT_WEBUI_NEON_AUTH_USERNAME_EMAIL_DOMAIN: 'users.craft.invalid',
    STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET: CLIENT_SESSION_SECRET,
    STORYFLOW_CLIENT_SESSION_JWT_CURRENT_KEY_ID: CLIENT_SESSION_KEY_ID,
    STORYFLOW_GATEWAY_JWT_CURRENT_KEY_ID: MODEL_ACCESS_KEY_ID,
    STORYFLOW_GATEWAY_JWT_CURRENT_SECRET: MODEL_ACCESS_SECRET,
    STORYFLOW_SKILLS_MARKET_JWT_CURRENT_KEY_ID: MARKET_KEY_ID,
    STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET: MARKET_SECRET,
    ...overrides,
  }
}

async function verifyClientSessionToken(token: unknown) {
  expect(typeof token).toBe('string')
  expect(decodeProtectedHeader(token as string).kid).toBe(CLIENT_SESSION_KEY_ID)
  const { payload } = await jwtVerify(
    token as string,
    new TextEncoder().encode(CLIENT_SESSION_SECRET),
    {
      algorithms: ['HS256'],
      issuer: 'storyflow-auth-broker',
      audience: 'storyflow-client-auth',
    },
  )
  return payload
}

async function verifyModelAccessToken(token: unknown) {
  expect(typeof token).toBe('string')
  expect(decodeProtectedHeader(token as string).kid).toBe(MODEL_ACCESS_KEY_ID)
  const { payload } = await jwtVerify(
    token as string,
    new TextEncoder().encode(MODEL_ACCESS_SECRET),
    {
      algorithms: ['HS256'],
      issuer: 'storyflow-auth-broker',
      audience: 'storyflow-model-gateway',
    },
  )
  return payload
}

async function verifyMarketPublishToken(token: unknown) {
  expect(typeof token).toBe('string')
  expect(decodeProtectedHeader(token as string).kid).toBe(MARKET_KEY_ID)
  const { payload } = await jwtVerify(
    token as string,
    new TextEncoder().encode(MARKET_SECRET),
    {
      algorithms: ['HS256'],
      issuer: 'storyflow-auth-broker',
      audience: 'storyflow-skills-market',
    },
  )
  return payload
}

async function createNeonProviderToken(claims: Record<string, unknown>) {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const publicJwk = await exportJWK(publicKey)
  publicJwk.kid = 'test-key'
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer('https://ep-test.neonauth.aws.neon.build')
    .setAudience('https://ep-test.neonauth.aws.neon.build')
    .setSubject('neon_user_123')
    .setExpirationTime('5m')
    .sign(privateKey)
  return { publicJwk, token }
}

describe('auth broker worker', () => {
  it('reports readiness only for the explicit dual-token configuration', async () => {
    const ready = await handleRequest(
      new Request('https://auth.example.com/ready'),
      makeEnv(),
    )
    const legacyOnly = await handleRequest(
      new Request('https://auth.example.com/ready'),
      makeEnv({
        STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET: undefined,
        STORYFLOW_GATEWAY_JWT_CURRENT_SECRET: undefined,
        STORYFLOW_CLIENT_SESSION_JWT_SECRET: CLIENT_SESSION_SECRET,
        STORYFLOW_GATEWAY_JWT_SECRET: MODEL_ACCESS_SECRET,
      }),
    )

    expect(ready.status).toBe(200)
    expect(await ready.json()).toEqual({ status: 'ready' })
    expect(legacyOnly.status).toBe(503)
    expect(await legacyOnly.json()).toEqual({
      status: 'not_ready',
      code: 'configuration_invalid',
    })
  })

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

  it('exchanges Feishu OAuth codes for a durable session and bounded pro model access', async () => {
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
      makeEnv({
        CRAFT_WEBUI_FEISHU_ALLOW_ALL_USERS: 'false',
        CRAFT_WEBUI_FEISHU_INTERNAL_TENANT_KEYS: 'tenant_external',
      }),
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
              avatar_url: 'https://example.com/desktop-user.png',
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
      organizationId: 'storyflow',
      email: 'desktop.user@example.com',
      name: 'Desktop User',
      avatarUrl: 'https://example.com/desktop-user.png',
    })
    const sessionPayload = await verifyClientSessionToken(body.appSessionToken)
    expect(sessionPayload.sub).toBe('feishu:ou_desktop')
    expect(sessionPayload.scope).toBe('model:issue')
    expect(sessionPayload.model_tier).toBe('pro')
    expect(sessionPayload.user_name).toBe('Desktop User')
    expect(sessionPayload.organization_id).toBe('storyflow')
    expect((sessionPayload.exp as number) - (sessionPayload.iat as number)).toBe(90 * 24 * 60 * 60)

    const payload = await verifyModelAccessToken(body.modelAccessToken)
    expect(payload.sub).toBe('feishu:ou_desktop')
    expect(payload.scopes).toEqual(['model:chat', 'model:video', 'catalog:read'])
    expect(payload.model_tier).toBe('pro')
    expect(payload.user_name).toBe('Desktop User')
    expect((payload.exp as number) - (payload.iat as number)).toBe(24 * 60 * 60)

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

  it('does not grant pro access to Feishu users outside the company tenant', async () => {
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
      makeEnv({
        CRAFT_WEBUI_FEISHU_ALLOW_ALL_USERS: 'false',
        CRAFT_WEBUI_FEISHU_INTERNAL_TENANT_KEYS: 'tenant_company',
      }),
      async (input) => {
        if (input.toString().endsWith('/open-apis/authen/v2/oauth/token')) {
          return Response.json({ access_token: 'feishu-access-token' })
        }
        return Response.json({
          data: {
            open_id: 'ou_external',
            tenant_key: 'tenant_external',
          },
        })
      },
    )

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Registration required' })
  })

  it('does not attach the company organization to allow-listed external Feishu users', async () => {
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
      makeEnv({ CRAFT_WEBUI_FEISHU_INTERNAL_TENANT_KEYS: 'tenant_company' }),
      async (input) => input.toString().endsWith('/open-apis/authen/v2/oauth/token')
        ? Response.json({ access_token: 'feishu-access-token' })
        : Response.json({ data: { open_id: 'ou_external', tenant_key: 'tenant_external' } }),
    )

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, any>
    expect(body.user.organizationId).toBeUndefined()
    expect((await verifyClientSessionToken(body.appSessionToken)).organization_id).toBeUndefined()
  })

  it('exchanges any verified Neon Auth email for a standard model access token', async () => {
    const { publicJwk, token } = await createNeonProviderToken({
      email: 'Neon.User@Example.com',
      emailVerified: true,
    })

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
    const sessionPayload = await verifyClientSessionToken(body.appSessionToken)
    expect(sessionPayload.sub).toBe('neon:neon_user_123')
    expect(sessionPayload.scope).toBe('model:issue')
    expect(sessionPayload.model_tier).toBe('standard')
    expect(sessionPayload.organization_id).toBeUndefined()

    const payload = await verifyModelAccessToken(body.modelAccessToken)
    expect(payload.sub).toBe('neon:neon_user_123')
    expect(payload.scopes).toEqual(['model:chat', 'model:video', 'catalog:read'])
    expect(payload.model_tier).toBe('standard')
  })

  it('does not issue capabilities to unverified or banned Neon identities', async () => {
    for (const [claims, error] of [
      [{ emailVerified: false }, 'Email verification is required'],
      [{ emailVerified: true, banned: true }, 'Neon Auth user is banned'],
    ] as const) {
      const { publicJwk, token } = await createNeonProviderToken(claims)
      const res = await handleRequest(
        new Request('https://auth.example.com/api/client-auth/neon/exchange', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }),
        makeEnv(),
        async () => Response.json({ keys: [publicJwk] }),
      )

      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error })
    }
  })

  it('rejects insecure remote Neon Auth configuration before token verification', async () => {
    const res = await handleRequest(
      new Request('https://auth.example.com/api/client-auth/neon/exchange', {
        method: 'POST',
        headers: { Authorization: 'Bearer provider-token' },
      }),
      makeEnv({ CRAFT_WEBUI_NEON_AUTH_BASE_URL: 'http://auth.example.com/neondb/auth' }),
    )

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      error: 'Neon Auth URL must use HTTPS, except for loopback development',
    })
  })

  it('refreshes a previous-key client session into current session and model tokens', async () => {
    const now = Math.floor(Date.now() / 1000)
    const authenticatedAt = now - 10 * 24 * 60 * 60
    const appSessionToken = await new SignJWT({
      scope: 'model:issue',
      model_tier: 'standard',
      auth_time: authenticatedAt,
      user_name: 'Desktop User',
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid: PREVIOUS_CLIENT_SESSION_KEY_ID })
      .setIssuer('storyflow-auth-broker')
      .setAudience('storyflow-client-auth')
      .setSubject('feishu:legacy-user')
      .setIssuedAt(now)
      .setExpirationTime(authenticatedAt + 90 * 24 * 60 * 60)
      .sign(new TextEncoder().encode(PREVIOUS_CLIENT_SESSION_SECRET))

    const res = await handleRequest(
      new Request('https://auth.example.com/api/client-auth/token', {
        method: 'POST',
        headers: { Authorization: `Bearer ${appSessionToken}` },
      }),
      makeEnv({
        STORYFLOW_CLIENT_SESSION_JWT_PREVIOUS_KEY_ID: PREVIOUS_CLIENT_SESSION_KEY_ID,
        STORYFLOW_CLIENT_SESSION_JWT_PREVIOUS_SECRET: PREVIOUS_CLIENT_SESSION_SECRET,
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, any>
    expect(Object.keys(body).sort()).toEqual(['appSessionToken', 'modelAccessToken', 'ok'])
    expect(body.ok).toBe(true)

    const sessionPayload = await verifyClientSessionToken(body.appSessionToken)
    expect(sessionPayload.sub).toBe('feishu:legacy-user')
    expect(sessionPayload.scope).toBe('model:issue')
    expect(sessionPayload.model_tier).toBe('standard')
    expect(sessionPayload.user_name).toBe('Desktop User')
    expect(sessionPayload.auth_time).toBe(authenticatedAt)
    expect(sessionPayload.exp).toBe(authenticatedAt + 90 * 24 * 60 * 60)
    expect((sessionPayload.exp as number) - (sessionPayload.iat as number)).toBeLessThan(90 * 24 * 60 * 60)

    const modelPayload = await verifyModelAccessToken(body.modelAccessToken)
    expect(modelPayload.sub).toBe('feishu:legacy-user')
    expect(modelPayload.model_tier).toBe('standard')
    expect(modelPayload.user_name).toBe('Desktop User')
    expect(modelPayload.exp as number).toBeLessThanOrEqual(sessionPayload.exp as number)
  })

  it('renews Neon capabilities from the bounded Storyflow identity session', async () => {
    const now = Math.floor(Date.now() / 1000)
    const appSessionToken = await new SignJWT({
      scope: 'model:issue',
      model_tier: 'standard',
      auth_time: now,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid: CLIENT_SESSION_KEY_ID })
      .setIssuer('storyflow-auth-broker')
      .setAudience('storyflow-client-auth')
      .setSubject('neon:neon_user_123')
      .setIssuedAt(now)
      .setExpirationTime(now + 90 * 24 * 60 * 60)
      .sign(new TextEncoder().encode(CLIENT_SESSION_SECRET))

    const res = await handleRequest(
      new Request('https://auth.example.com/api/client-auth/token', {
        method: 'POST',
        headers: { Authorization: `Bearer ${appSessionToken}` },
      }),
      makeEnv(),
    )

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    const modelPayload = await verifyModelAccessToken(body.modelAccessToken)
    expect((modelPayload.exp as number) - (modelPayload.iat as number)).toBe(24 * 60 * 60)
    expect((await verifyClientSessionToken(body.appSessionToken)).organization_id).toBeUndefined()
  })

  it('rejects invalid client sessions without issuing replacement tokens', async () => {
    const res = await handleRequest(
      new Request('https://auth.example.com/api/client-auth/token', {
        method: 'POST',
        headers: { Authorization: 'Bearer invalid-client-session' },
      }),
      makeEnv(),
    )

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: 'Invalid client session token',
      code: 'client_session_token_invalid',
    })
  })

  it('issues a five-minute publish capability from a valid client session', async () => {
    const now = Math.floor(Date.now() / 1000)
    const appSessionToken = await new SignJWT({
      scope: 'model:issue',
      model_tier: 'standard',
      auth_time: now,
      user_name: 'Desktop Author',
      organization_id: 'storyflow',
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid: CLIENT_SESSION_KEY_ID })
      .setIssuer('storyflow-auth-broker')
      .setAudience('storyflow-client-auth')
      .setSubject('feishu:author-1')
      .setIssuedAt(now)
      .setExpirationTime(now + 90 * 24 * 60 * 60)
      .sign(new TextEncoder().encode(CLIENT_SESSION_SECRET))

    const res = await handleRequest(
      new Request('https://auth.example.com/api/client-auth/skills-market/token', {
        method: 'POST',
        headers: { Authorization: `Bearer ${appSessionToken}` },
      }),
      makeEnv(),
    )

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, any>
    expect(body.expiresInSeconds).toBe(300)
    const payload = await verifyMarketPublishToken(body.marketPublishToken)
    expect(payload.sub).toBe('feishu:author-1')
    expect(payload.scopes).toEqual(['skills:read', 'skills:publish'])
    expect(payload.user_name).toBe('Desktop Author')
    expect(payload.organization_id).toBe('storyflow')
    expect(payload).not.toHaveProperty('model_tier')
    expect((payload.exp as number) - (payload.iat as number)).toBe(300)
  })

  it('does not extend a client session beyond 90 days from authentication', async () => {
    const now = Math.floor(Date.now() / 1000)
    const appSessionToken = await new SignJWT({
      scope: 'model:issue',
      model_tier: 'standard',
      auth_time: now - 91 * 24 * 60 * 60,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid: CLIENT_SESSION_KEY_ID })
      .setIssuer('storyflow-auth-broker')
      .setAudience('storyflow-client-auth')
      .setSubject('feishu:expired-user')
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(new TextEncoder().encode(CLIENT_SESSION_SECRET))

    const res = await handleRequest(
      new Request('https://auth.example.com/api/client-auth/token', {
        method: 'POST',
        headers: { Authorization: `Bearer ${appSessionToken}` },
      }),
      makeEnv(),
    )

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: 'Invalid client session token',
      code: 'client_session_token_invalid',
    })
  })

  it('requires enough parent-session lifetime for another model operation', async () => {
    const now = Math.floor(Date.now() / 1000)
    const authenticatedAt = now - 90 * 24 * 60 * 60 + 12 * 60 * 60
    const appSessionToken = await new SignJWT({
      scope: 'model:issue',
      model_tier: 'standard',
      auth_time: authenticatedAt,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid: CLIENT_SESSION_KEY_ID })
      .setIssuer('storyflow-auth-broker')
      .setAudience('storyflow-client-auth')
      .setSubject('feishu:expiring-user')
      .setIssuedAt(now)
      .setExpirationTime(authenticatedAt + 90 * 24 * 60 * 60)
      .sign(new TextEncoder().encode(CLIENT_SESSION_SECRET))

    const res = await handleRequest(
      new Request('https://auth.example.com/api/client-auth/token', {
        method: 'POST',
        headers: { Authorization: `Bearer ${appSessionToken}` },
      }),
      makeEnv(),
    )

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: 'Invalid client session token',
      code: 'client_session_token_invalid',
    })
  })

  it('fails closed when model access token signing is not configured', async () => {
    const res = await handleRequest(
      new Request('https://auth.example.com/api/client-auth/neon/exchange', {
        method: 'POST',
        headers: { Authorization: 'Bearer provider-token' },
      }),
      makeEnv({ STORYFLOW_GATEWAY_JWT_CURRENT_SECRET: undefined }),
    )

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Model access token signing is not configured' })
  })

  it('rejects deployments that reuse one secret for both token classes', async () => {
    const res = await handleRequest(
      new Request('https://auth.example.com/api/client-auth/neon/exchange', {
        method: 'POST',
        headers: { Authorization: 'Bearer provider-token' },
      }),
      makeEnv({
        STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET: MODEL_ACCESS_SECRET,
      }),
    )

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      error: 'Client session and model access tokens require separate signing secrets',
    })
  })

  it('fails closed when the Skills Market secret is missing or reused', async () => {
    const missing = await handleRequest(
      new Request('https://auth.example.com/ready'),
      makeEnv({ STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET: undefined }),
    )
    const reused = await handleRequest(
      new Request('https://auth.example.com/ready'),
      makeEnv({ STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET: MODEL_ACCESS_SECRET }),
    )

    expect(missing.status).toBe(503)
    expect(reused.status).toBe(503)
  })
})
