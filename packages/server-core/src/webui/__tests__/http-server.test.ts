import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { jwtVerify } from 'jose'
import { startWebuiHttpServer } from '../http-server'
import type { FeishuAuthConfig, FeishuOAuthClient, FeishuUserInfo } from '../feishu-auth'
import type { NeonAuthConfig } from '../neon-auth'

const SECRET = 'test-server-secret'
const PASSWORD = 'test-password'
const TEMP_DIRS: string[] = []
const SERVERS: Array<{ stop: () => void }> = []

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as any

function createTestWebuiDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'craft-webui-test-'))
  TEMP_DIRS.push(dir)
  writeFileSync(join(dir, 'login.html'), '<!doctype html><html><body>login</body></html>')
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body>app</body></html>')
  return dir
}

async function createServer(overrides?: {
  secureCookies?: boolean
  publicWsUrl?: string
  wsProtocol?: 'ws' | 'wss'
  wsPort?: number
  feishuAuth?: FeishuAuthConfig
  neonAuth?: NeonAuthConfig
  passwordAuthEnabled?: boolean
  clientGatewayToken?: string
  clientGatewayJwtSecret?: string
  clientGatewayTokenTtlSeconds?: number
  clientGatewayConnectionSlugs?: string[]
}) {
  const server = await startWebuiHttpServer({
    port: 0,
    webuiDir: createTestWebuiDir(),
    secret: SECRET,
    password: PASSWORD,
    secureCookies: overrides?.secureCookies,
    publicWsUrl: overrides?.publicWsUrl,
    wsProtocol: overrides?.wsProtocol ?? 'wss',
    wsPort: overrides?.wsPort ?? 9100,
    getHealthCheck: () => ({ status: 'ok' }),
    logger,
    feishuAuth: overrides?.feishuAuth,
    neonAuth: overrides?.neonAuth,
    passwordAuthEnabled: overrides?.passwordAuthEnabled,
    clientGatewayToken: overrides?.clientGatewayToken,
    clientGatewayJwtSecret: overrides?.clientGatewayJwtSecret,
    clientGatewayTokenTtlSeconds: overrides?.clientGatewayTokenTtlSeconds,
    clientGatewayConnectionSlugs: overrides?.clientGatewayConnectionSlugs,
  })

  SERVERS.push(server)

  return {
    server,
    baseUrl: `http://127.0.0.1:${server.port}`,
  }
}

async function withoutGatewayTokenEnv<T>(fn: () => Promise<T>): Promise<T> {
  const previousClientToken = process.env.CRAFT_CLIENT_GATEWAY_TOKEN
  const previousBuiltinToken = process.env.CRAFT_BUILTIN_LLM_API_KEY
  const previousJwtSecret = process.env.CRAFT_CLIENT_GATEWAY_JWT_SECRET
  delete process.env.CRAFT_CLIENT_GATEWAY_TOKEN
  delete process.env.CRAFT_BUILTIN_LLM_API_KEY
  delete process.env.CRAFT_CLIENT_GATEWAY_JWT_SECRET

  try {
    return await fn()
  } finally {
    if (previousClientToken === undefined) {
      delete process.env.CRAFT_CLIENT_GATEWAY_TOKEN
    } else {
      process.env.CRAFT_CLIENT_GATEWAY_TOKEN = previousClientToken
    }

    if (previousBuiltinToken === undefined) {
      delete process.env.CRAFT_BUILTIN_LLM_API_KEY
    } else {
      process.env.CRAFT_BUILTIN_LLM_API_KEY = previousBuiltinToken
    }

    if (previousJwtSecret === undefined) {
      delete process.env.CRAFT_CLIENT_GATEWAY_JWT_SECRET
    } else {
      process.env.CRAFT_CLIENT_GATEWAY_JWT_SECRET = previousJwtSecret
    }
  }
}

function extractSessionCookie(res: Response): string {
  const setCookie = res.headers.get('set-cookie')
  expect(setCookie).toBeTruthy()
  return setCookie!.split(';')[0]!
}

function createFeishuAuthConfig(user: FeishuUserInfo, registered = false): FeishuAuthConfig {
  const client: FeishuOAuthClient = {
    exchangeCode: async () => ({ accessToken: 'feishu-access-token' }),
    getUserInfo: async () => user,
  }

  return {
    appId: 'cli_test',
    appSecret: 'secret_test',
    internalTenantKeys: ['tenant_internal'],
    client,
    registrationStore: {
      isRegistered: async () => registered,
    },
  }
}

function createNeonAuthConfig(overrides?: Partial<NeonAuthConfig>): NeonAuthConfig {
  return {
    baseUrl: 'https://ep-test.neonauth.aws.neon.build/neondb/auth',
    tokenVerifier: async (token) => {
      if (token !== 'valid-neon-token') return null
      return {
        sub: 'neon_user_123',
        email: 'Neon.User@Example.com',
        emailVerified: true,
      }
    },
    ...overrides,
  }
}

async function startFeishuLogin(baseUrl: string): Promise<URL> {
  const res = await fetch(`${baseUrl}/api/auth/feishu/start`, { redirect: 'manual' })
  expect(res.status).toBe(302)
  const location = res.headers.get('location')
  expect(location).toBeTruthy()
  return new URL(location!)
}

afterEach(() => {
  while (SERVERS.length > 0) {
    SERVERS.pop()?.stop()
  }

  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('startWebuiHttpServer', () => {
  it('allows plain-http login even when the RPC transport is wss', async () => {
    const { baseUrl } = await createServer({ wsProtocol: 'wss', wsPort: 9100 })

    const authRes = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    })

    expect(authRes.status).toBe(200)
    const setCookie = authRes.headers.get('set-cookie')
    expect(setCookie).toContain('craft_session=')
    expect(setCookie).not.toContain('Secure')

    const configRes = await fetch(`${baseUrl}/api/config`, {
      headers: {
        cookie: extractSessionCookie(authRes),
      },
    })

    expect(configRes.status).toBe(200)
    expect(await configRes.json()).toEqual({
      wsUrl: 'wss://127.0.0.1:9100',
    })
  })

  it('rejects invalid credentials', async () => {
    const { baseUrl } = await createServer()

    const res = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-password' }),
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid credentials' })
  })

  it('honors an explicit secure-cookie override', async () => {
    const { baseUrl } = await createServer({ secureCookies: true, wsProtocol: 'ws', wsPort: 9100 })

    const res = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('Secure')
  })

  it('infers secure cookies from proxy https headers when no override is set', async () => {
    const { baseUrl } = await createServer({ wsProtocol: 'wss', wsPort: 9100 })

    const res = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify({ password: PASSWORD }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('Secure')
  })

  it('derives a browser-facing websocket URL from forwarded public host headers', async () => {
    const { baseUrl } = await createServer({ wsProtocol: 'wss', wsPort: 9100 })

    const authRes = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'craft.example.com:3100',
      },
      body: JSON.stringify({ password: PASSWORD }),
    })

    const configRes = await fetch(`${baseUrl}/api/config`, {
      headers: {
        cookie: extractSessionCookie(authRes),
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'craft.example.com:3100',
      },
    })

    expect(configRes.status).toBe(200)
    expect(await configRes.json()).toEqual({
      wsUrl: 'wss://craft.example.com:9100',
    })
  })

  it('returns an explicit public websocket URL override from /api/config', async () => {
    const { baseUrl } = await createServer({
      publicWsUrl: 'wss://craft.example.com/ws',
      wsProtocol: 'wss',
      wsPort: 9100,
    })

    const authRes = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    })

    const configRes = await fetch(`${baseUrl}/api/config`, {
      headers: {
        cookie: extractSessionCookie(authRes),
      },
    })

    expect(configRes.status).toBe(200)
    expect(await configRes.json()).toEqual({
      wsUrl: 'wss://craft.example.com/ws',
    })
  })

  it('reports Feishu login disabled by default', async () => {
    const { baseUrl } = await createServer()

    const res = await fetch(`${baseUrl}/api/auth/feishu/config`)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: false })
  })

  it('reports Neon Auth disabled by default', async () => {
    const { baseUrl } = await createServer()

    const res = await fetch(`${baseUrl}/api/auth/neon/config`)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: false })
  })

  it('exposes configured Neon Auth base URL without verifier details', async () => {
    const { baseUrl } = await createServer({
      neonAuth: createNeonAuthConfig({
        baseUrl: 'https://ep-test.neonauth.aws.neon.build/neondb/auth/',
        jwksUrl: 'https://private.example.com/jwks.json',
      }),
    })

    const res = await fetch(`${baseUrl}/api/auth/neon/config`)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      enabled: true,
      baseUrl: 'https://ep-test.neonauth.aws.neon.build/neondb/auth',
    })
  })

  it('can disable server-token password login when account auth is required', async () => {
    const { baseUrl } = await createServer({
      passwordAuthEnabled: false,
      neonAuth: createNeonAuthConfig(),
    })

    const configRes = await fetch(`${baseUrl}/api/auth/neon/config`)
    expect(configRes.status).toBe(200)
    expect(await configRes.json()).toEqual({
      enabled: true,
      baseUrl: 'https://ep-test.neonauth.aws.neon.build/neondb/auth',
      passwordAuthEnabled: false,
    })

    const passwordRes = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    })

    expect(passwordRes.status).toBe(403)
    expect(await passwordRes.json()).toEqual({ error: 'Password login is disabled' })
    expect(passwordRes.headers.get('set-cookie')).toBeNull()
  })

  it('rejects Neon Auth exchange without a token', async () => {
    const { baseUrl } = await createServer({
      neonAuth: createNeonAuthConfig(),
    })

    const res = await fetch(`${baseUrl}/api/auth/neon/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Neon Auth token is required' })
  })

  it('rejects invalid Neon Auth exchange tokens', async () => {
    const { baseUrl } = await createServer({
      neonAuth: createNeonAuthConfig(),
    })

    const res = await fetch(`${baseUrl}/api/auth/neon/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'wrong-token' }),
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid Neon Auth token' })
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('sets a session cookie for valid Neon Auth exchange tokens', async () => {
    const { baseUrl } = await createServer({
      neonAuth: createNeonAuthConfig(),
    })

    const exchangeRes = await fetch(`${baseUrl}/api/auth/neon/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'valid-neon-token' }),
    })

    expect(exchangeRes.status).toBe(200)
    expect(await exchangeRes.json()).toEqual({
      ok: true,
      user: {
        provider: 'neon',
        userId: 'neon_user_123',
        email: 'neon.user@example.com',
        emailVerified: true,
      },
    })

    const configRes = await fetch(`${baseUrl}/api/config`, {
      headers: {
        cookie: extractSessionCookie(exchangeRes),
      },
    })

    expect(configRes.status).toBe(200)
  })

  it('sets a session cookie after Neon Auth email sign-in returns a valid access token', async () => {
    const requests: Array<{ url: string, init?: RequestInit }> = []
    const { baseUrl } = await createServer({
      neonAuth: createNeonAuthConfig({
        fetch: async (input, init) => {
          requests.push({ url: String(input), init })
          return Response.json({
            data: {
              session: { access_token: 'email-sign-in-token' },
              user: {
                id: 'neon_email_user',
                email: 'email.user@example.com',
                emailVerified: true,
              },
            },
          })
        },
        tokenVerifier: async (token) => {
          if (token !== 'email-sign-in-token') return null
          return {
            sub: 'neon_email_user',
            email: 'email.user@example.com',
            emailVerified: true,
          }
        },
      }),
    })

    const res = await fetch(`${baseUrl}/api/auth/neon/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'sign-in',
        email: 'Email.User@Example.com',
        password: 'secret-password',
      }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      user: {
        provider: 'neon',
        userId: 'neon_email_user',
        email: 'email.user@example.com',
        emailVerified: true,
      },
    })
    expect(requests[0]?.url).toBe('https://ep-test.neonauth.aws.neon.build/neondb/auth/sign-in/email')
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      email: 'email.user@example.com',
      password: 'secret-password',
    })

    const configRes = await fetch(`${baseUrl}/api/config`, {
      headers: {
        cookie: extractSessionCookie(res),
      },
    })

    expect(configRes.status).toBe(200)
  })

  it('reports Neon Auth email sign-up verification without setting a local session', async () => {
    const { baseUrl } = await createServer({
      neonAuth: createNeonAuthConfig({
        fetch: async () => Response.json({
          data: {
            user: {
              id: 'neon_pending_user',
              email: 'pending@example.com',
              emailVerified: false,
            },
          },
        }),
      }),
    })

    const res = await fetch(`${baseUrl}/api/auth/neon/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'sign-up',
        email: 'pending@example.com',
        password: 'secret-password',
      }),
    })

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({
      ok: false,
      status: 'verification-required',
      user: {
        id: 'neon_pending_user',
        email: 'pending@example.com',
        emailVerified: false,
      },
    })
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('starts Feishu login when configured', async () => {
    const { baseUrl } = await createServer({
      feishuAuth: createFeishuAuthConfig({
        openId: 'ou_internal',
        tenantKey: 'tenant_internal',
      }),
    })

    const url = await startFeishuLogin(baseUrl)

    expect(url.origin + url.pathname).toBe('https://accounts.feishu.cn/open-apis/authen/v1/authorize')
    expect(url.searchParams.get('client_id')).toBe('cli_test')
    expect(url.searchParams.get('redirect_uri')).toBe(`${baseUrl}/api/auth/feishu/callback`)
    expect(url.searchParams.get('state')).toBeTruthy()
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
  })

  it('exposes public Feishu client auth config from the broker', async () => {
    const { baseUrl } = await createServer({
      feishuAuth: {
        ...createFeishuAuthConfig({
          openId: 'ou_internal',
          tenantKey: 'tenant_internal',
        }),
        appId: 'cli_user_deployment',
        scope: 'offline_access',
        authBaseUrl: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
      },
    })

    const res = await fetch(`${baseUrl}/api/client-auth/feishu/config`)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      enabled: true,
      appId: 'cli_user_deployment',
      scope: 'offline_access',
      authBaseUrl: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
    })
  })

  it('sets a session cookie for company-internal Feishu users', async () => {
    const { baseUrl } = await createServer({
      feishuAuth: createFeishuAuthConfig({
        openId: 'ou_internal',
        tenantKey: 'tenant_internal',
        email: 'internal@example.com',
      }),
    })

    const authUrl = await startFeishuLogin(baseUrl)
    const callbackRes = await fetch(
      `${baseUrl}/api/auth/feishu/callback?code=auth_code&state=${authUrl.searchParams.get('state')}`,
      { redirect: 'manual' },
    )

    expect(callbackRes.status).toBe(302)
    expect(callbackRes.headers.get('location')).toBe('/')
    const cookie = extractSessionCookie(callbackRes)

    const configRes = await fetch(`${baseUrl}/api/config`, {
      headers: { cookie },
    })

    expect(configRes.status).toBe(200)
  })

  it('exchanges desktop Feishu OAuth codes through the server-side auth broker', async () => {
    const exchangeCalls: Array<{ code: string, redirectUri: string, codeVerifier: string }> = []
    const client: FeishuOAuthClient = {
      exchangeCode: async (input) => {
        exchangeCalls.push(input)
        return { accessToken: 'feishu-access-token' }
      },
      getUserInfo: async () => ({
        openId: 'ou_desktop',
        tenantKey: 'tenant_internal',
        enterpriseEmail: 'Desktop.User@Example.com',
        name: 'Desktop User',
      }),
    }
    const { baseUrl } = await createServer({
      feishuAuth: {
        appId: 'cli_test',
        appSecret: 'server-only-secret',
        internalTenantKeys: ['tenant_internal'],
        client,
      },
      clientGatewayToken: 'model-gateway-token',
    })

    const res = await fetch(`${baseUrl}/api/client-auth/feishu/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'desktop-code',
        redirectUri: 'http://localhost:6477/callback',
        codeVerifier: 'desktop-verifier',
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toMatchObject({
      ok: true,
      user: {
        provider: 'feishu',
        userId: 'ou_desktop',
        email: 'desktop.user@example.com',
        name: 'Desktop User',
      },
    })
    expect(typeof body.appSessionToken).toBe('string')
    expect(body.gatewayToken).toBe('model-gateway-token')
    expect(exchangeCalls).toEqual([{
      code: 'desktop-code',
      redirectUri: 'http://localhost:6477/callback',
      codeVerifier: 'desktop-verifier',
    }])
  })

  it('exchanges desktop Neon Auth tokens through the server-side auth broker', async () => {
    const { baseUrl } = await createServer({
      neonAuth: createNeonAuthConfig(),
      clientGatewayToken: 'model-gateway-token',
    })

    const res = await fetch(`${baseUrl}/api/client-auth/neon/exchange`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-neon-token',
      },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toMatchObject({
      ok: true,
      user: {
        provider: 'neon',
        userId: 'neon_user_123',
        email: 'neon.user@example.com',
        emailVerified: true,
      },
      gatewayToken: 'model-gateway-token',
    })
    expect(typeof body.appSessionToken).toBe('string')
  })

  it('issues a scoped model gateway JWT instead of returning the upstream gateway credential', async () => {
    const { baseUrl } = await createServer({
      neonAuth: createNeonAuthConfig(),
      clientGatewayToken: 'cfut-upstream-token',
      clientGatewayJwtSecret: 'broker-signing-secret',
      clientGatewayTokenTtlSeconds: 60,
      clientGatewayConnectionSlugs: ['wangsu-default', 'xiaomi-default'],
    })

    const res = await fetch(`${baseUrl}/api/client-auth/neon/exchange`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-neon-token',
      },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(typeof body.gatewayToken).toBe('string')
    expect(body.gatewayToken).not.toBe('cfut-upstream-token')

    const { payload, protectedHeader } = await jwtVerify(
      body.gatewayToken as string,
      new TextEncoder().encode('broker-signing-secret'),
      {
        audience: 'storyflow-model-gateway',
        issuer: 'storyflow-auth-broker',
      },
    )

    expect(protectedHeader.alg).toBe('HS256')
    expect(payload.sub).toBe('neon:neon_user_123')
    expect(payload.provider).toBe('neon')
    expect(payload.userId).toBe('neon_user_123')
    expect(payload.email).toBe('neon.user@example.com')
    expect(payload.emailVerified).toBe(true)
    expect(payload.scopes).toEqual(['model:chat'])
    expect(payload.connections).toEqual(['wangsu-default', 'xiaomi-default'])
    expect(typeof payload.exp).toBe('number')
  })

  it('does not return a model gateway token when the broker has no gateway credential configured', async () => {
    await withoutGatewayTokenEnv(async () => {
      const { baseUrl } = await createServer({
        neonAuth: createNeonAuthConfig(),
      })

      const res = await fetch(`${baseUrl}/api/client-auth/neon/exchange`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-neon-token',
        },
      })

      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      expect(body.appSessionToken).toBeTruthy()
      expect(body.gatewayToken).toBeUndefined()
    })
  })

  it('requires registration for unregistered external Feishu users', async () => {
    const { baseUrl } = await createServer({
      feishuAuth: createFeishuAuthConfig({
        openId: 'ou_external',
        tenantKey: 'tenant_external',
        email: 'external@example.com',
      }),
    })

    const authUrl = await startFeishuLogin(baseUrl)
    const callbackRes = await fetch(
      `${baseUrl}/api/auth/feishu/callback?code=auth_code&state=${authUrl.searchParams.get('state')}`,
      { redirect: 'manual' },
    )

    expect(callbackRes.status).toBe(403)
    expect(await callbackRes.text()).toContain('Registration required')
    expect(callbackRes.headers.get('set-cookie')).toBeNull()
  })
})
