// input: Web UI HTTP server config, temporary static files, and mocked auth providers.
// output: End-to-end HTTP contracts for login, cookies, company-scoped auth brokers, and Neon registration.
// pos: Server-side regression coverage for browser-facing auth and session boundaries.

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { jwtVerify, SignJWT } from 'jose'
import { createClientSessionToken } from '../auth'
import { startWebuiHttpServer } from '../http-server'
import type { FeishuAuthConfig, FeishuOAuthClient, FeishuUserInfo } from '../feishu-auth'
import type { NeonAuthConfig } from '../neon-auth'

const SECRET = 'test-server-secret'
const CLIENT_SESSION_SECRET = 'test-client-session-secret'
const CLIENT_SESSION_KEY_ID = 'client-current'
const MODEL_ACCESS_SECRET = 'test-model-access-secret'
const MODEL_ACCESS_KEY_ID = 'model-current'
const SKILLS_MARKET_SECRET = 'test-skills-market-secret'
const SKILLS_MARKET_KEY_ID = 'market-current'
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
  mkdirSync(join(dir, 'assets'))
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
  clientSessionTokenSecret?: string | null
  modelAccessTokenSecret?: string | null
  skillsMarketTokenSecret?: string | null
}) {
  const webuiDir = createTestWebuiDir()
  const server = await startWebuiHttpServer({
    port: 0,
    webuiDir,
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
    clientSessionTokenKeyRing: overrides?.clientSessionTokenSecret === null
      ? undefined
      : {
          current: {
            id: CLIENT_SESSION_KEY_ID,
            secret: overrides?.clientSessionTokenSecret ?? CLIENT_SESSION_SECRET,
          },
        },
    modelAccessTokenKey: overrides?.modelAccessTokenSecret === null
      ? undefined
      : {
          id: MODEL_ACCESS_KEY_ID,
          secret: overrides?.modelAccessTokenSecret ?? MODEL_ACCESS_SECRET,
        },
    skillsMarketTokenKey: overrides?.skillsMarketTokenSecret === null
      ? undefined
      : {
          id: SKILLS_MARKET_KEY_ID,
          secret: overrides?.skillsMarketTokenSecret ?? SKILLS_MARKET_SECRET,
        },
  })

  SERVERS.push(server)

  return {
    server,
    baseUrl: `http://127.0.0.1:${server.port}`,
    webuiDir,
  }
}

async function verifyModelAccessToken(token: unknown) {
  expect(typeof token).toBe('string')
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

async function verifyClientSessionToken(token: unknown) {
  expect(typeof token).toBe('string')
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
  const organizationId = overrides?.organizationId
  return {
    baseUrl: 'https://ep-test.neonauth.aws.neon.build/neondb/auth',
    tokenVerifier: async (token) => {
      if (token !== 'valid-neon-token') return null
      return {
        sub: 'neon_user_123',
        email: 'Neon.User@Example.com',
        emailVerified: true,
        ...(organizationId ? { o: { id: organizationId, role: 'member' } } : {}),
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

  it('serves login assets before a session exists', async () => {
    const { baseUrl, webuiDir } = await createServer()
    writeFileSync(join(webuiDir, 'assets', 'login-marker.js'), 'window.__login_loaded = true')

    const res = await fetch(`${baseUrl}/assets/login-marker.js`)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('window.__login_loaded = true')
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
      emailSignUpEnabled: false,
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
      emailSignUpEnabled: false,
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
        emailSignUpEnabled: true,
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

  it('allows the registered account to sign in after email verification', async () => {
    let emailVerified = false
    const { baseUrl } = await createServer({
      neonAuth: createNeonAuthConfig({
        emailSignUpEnabled: true,
        fetch: async (input) => {
          if (String(input).endsWith('/sign-up/email')) {
            return Response.json({
              data: {
                user: {
                  id: 'neon_verified_user',
                  email: 'verified@example.com',
                  emailVerified: false,
                },
              },
            })
          }

          emailVerified = true
          return Response.json({
            data: {
              session: { access_token: 'verified-sign-in-token' },
              user: {
                id: 'neon_verified_user',
                email: 'verified@example.com',
                emailVerified: true,
              },
            },
          })
        },
        tokenVerifier: async (token) => token === 'verified-sign-in-token'
          ? { sub: 'neon_verified_user', email: 'verified@example.com', emailVerified: true }
          : null,
      }),
    })

    const signUpRes = await fetch(`${baseUrl}/api/auth/neon/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'sign-up', email: 'verified@example.com', password: 'secret-password' }),
    })

    expect(signUpRes.status).toBe(202)
    expect(signUpRes.headers.get('set-cookie')).toBeNull()

    const signInRes = await fetch(`${baseUrl}/api/auth/neon/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'sign-in', email: 'verified@example.com', password: 'secret-password' }),
    })

    expect(emailVerified).toBe(true)
    expect(signInRes.status).toBe(200)
    expect(extractSessionCookie(signInRes)).toContain('craft_session=')
  })

  it('does not set a session cookie when sign-up returns an unverified token identity', async () => {
    const { baseUrl } = await createServer({
      neonAuth: createNeonAuthConfig({
        emailSignUpEnabled: true,
        fetch: async () => Response.json({
          data: {
            session: { access_token: 'unverified-signup-token' },
            user: {
              id: 'neon_pending_user',
              email: 'pending@example.com',
              emailVerified: false,
            },
          },
        }),
        tokenVerifier: async (token) => {
          if (token !== 'unverified-signup-token') return null
          return {
            sub: 'neon_pending_user',
            email: 'pending@example.com',
            emailVerified: false,
          }
        },
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

  it('rejects Neon Auth email sign-up when registration is not enabled', async () => {
    const requests: string[] = []
    const { baseUrl } = await createServer({
      neonAuth: createNeonAuthConfig({
        fetch: async (input) => {
          requests.push(String(input))
          return Response.json({ ok: true })
        },
      }),
    })

    const res = await fetch(`${baseUrl}/api/auth/neon/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'sign-up',
        email: 'blocked@example.com',
        password: 'secret-password',
      }),
    })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Email sign-up is disabled' })
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(requests).toEqual([])
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
        organizationId: 'storyflow',
        email: 'desktop.user@example.com',
        name: 'Desktop User',
      },
    })
    expect(typeof body.appSessionToken).toBe('string')
    const appSession = await verifyClientSessionToken(body.appSessionToken)
    expect(appSession.scope).toBe('model:issue')
    expect(appSession.model_tier).toBe('pro')
    expect(appSession.organization_id).toBe('storyflow')
    expect(appSession.user_name).toBe('Desktop User')
    const marketTokenResponse = await fetch(`${baseUrl}/api/client-auth/skills-market/token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${body.appSessionToken as string}` },
    })
    const marketTokenBody = await marketTokenResponse.json() as Record<string, unknown>
    const { payload: marketPayload } = await jwtVerify(
      marketTokenBody.marketPublishToken as string,
      new TextEncoder().encode(SKILLS_MARKET_SECRET),
      {
        algorithms: ['HS256'],
        issuer: 'storyflow-auth-broker',
        audience: 'storyflow-skills-market',
      },
    )
    expect(marketPayload.scopes).toEqual(['skills:read', 'skills:publish'])
    expect(marketPayload.organization_id).toBe('storyflow')
    expect(marketPayload.user_name).toBe('Desktop User')
    const modelAccess = await verifyModelAccessToken(body.modelAccessToken)
    expect(modelAccess.sub).toBe('feishu:ou_desktop')
    expect(modelAccess.model_tier).toBe('pro')
    expect((modelAccess.exp as number) - (modelAccess.iat as number)).toBe(900)
    expect(exchangeCalls).toEqual([{
      code: 'desktop-code',
      redirectUri: 'http://localhost:6477/callback',
      codeVerifier: 'desktop-verifier',
    }])
  })

  it('exchanges desktop Neon Auth tokens through the server-side auth broker', async () => {
    const { baseUrl } = await createServer({
      neonAuth: createNeonAuthConfig({ organizationId: 'org_storyflow' }),
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
        organizationId: 'org_storyflow',
        organizationRole: 'member',
      },
    })
    expect(typeof body.appSessionToken).toBe('string')
    const appSession = await verifyClientSessionToken(body.appSessionToken)
    expect(appSession.scope).toBe('model:issue')
    expect(appSession.model_tier).toBe('standard')
    expect(appSession.organization_id).toBe('org_storyflow')
    const modelAccess = await verifyModelAccessToken(body.modelAccessToken)
    expect(modelAccess.sub).toBe('neon:neon_user_123')
    expect(modelAccess.model_tier).toBe('standard')
  })

  it('keeps product sessions and model access tokens as separate credentials', async () => {
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
    expect(typeof body.appSessionToken).toBe('string')
    expect(typeof body.modelAccessToken).toBe('string')
    expect(body.modelAccessToken).not.toBe(body.appSessionToken)
  })

  it('fails closed when the local client-auth broker cannot issue model access', async () => {
    const { baseUrl } = await createServer({
      neonAuth: createNeonAuthConfig(),
      modelAccessTokenSecret: null,
    })

    const res = await fetch(`${baseUrl}/api/client-auth/neon/exchange`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-neon-token',
      },
    })

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      error: 'Client auth token signing is not configured',
    })
  })

  it('fails closed when the local client-auth broker has no independent client-session key', async () => {
    const { baseUrl } = await createServer({
      neonAuth: createNeonAuthConfig(),
      clientSessionTokenSecret: null,
    })

    const res = await fetch(`${baseUrl}/api/client-auth/neon/exchange`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-neon-token',
      },
    })

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      error: 'Client auth token signing is not configured',
    })
  })

  it('renews a Neon client session only with a fresh organization token', async () => {
    const { baseUrl } = await createServer({
      neonAuth: createNeonAuthConfig({ organizationId: 'org_storyflow' }),
    })
    const login = await fetch(`${baseUrl}/api/client-auth/neon/exchange`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-neon-token' },
    })
    const loginBody = await login.json() as Record<string, unknown>

    const refreshed = await fetch(`${baseUrl}/api/client-auth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${loginBody.appSessionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ providerToken: 'valid-neon-token' }),
    })

    expect(refreshed.status).toBe(200)
    const refreshedBody = await refreshed.json() as Record<string, unknown>
    expect(Object.keys(refreshedBody).sort()).toEqual([
      'appSessionToken',
      'modelAccessToken',
      'ok',
    ])
    const appSession = await verifyClientSessionToken(refreshedBody.appSessionToken)
    expect(appSession.sub).toBe('neon:neon_user_123')
    expect(appSession.model_tier).toBe('standard')
    expect(appSession.organization_id).toBe('org_storyflow')
    const loginSession = await verifyClientSessionToken(loginBody.appSessionToken)
    expect(appSession.auth_time).toBe(loginSession.auth_time)
    expect(appSession.exp).toBe(loginSession.exp)
    const modelAccess = await verifyModelAccessToken(refreshedBody.modelAccessToken)
    expect(modelAccess.sub).toBe('neon:neon_user_123')
  })

  it('rejects Neon client-session renewal without a fresh provider token', async () => {
    const { baseUrl } = await createServer({
      neonAuth: createNeonAuthConfig({ organizationId: 'org_storyflow' }),
    })
    const login = await fetch(`${baseUrl}/api/client-auth/neon/exchange`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-neon-token' },
    })
    const loginBody = await login.json() as Record<string, unknown>

    const refreshed = await fetch(`${baseUrl}/api/client-auth/token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${loginBody.appSessionToken}` },
    })

    expect(refreshed.status).toBe(401)
    expect(await refreshed.json()).toEqual({
      error: 'Neon Auth session is required',
      code: 'neon_session_required',
    })
  })

  it('rejects Neon client-session renewal after organization membership is removed', async () => {
    let isMember = true
    const { baseUrl } = await createServer({
      neonAuth: createNeonAuthConfig({
        organizationId: 'org_storyflow',
        tokenVerifier: async token => token === 'valid-neon-token'
          ? {
              sub: 'neon_user_123',
              email: 'neon.user@example.com',
              emailVerified: true,
              ...(isMember ? { o: { id: 'org_storyflow', role: 'member' } } : {}),
            }
          : null,
      }),
    })
    const login = await fetch(`${baseUrl}/api/client-auth/neon/exchange`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-neon-token' },
    })
    const loginBody = await login.json() as Record<string, unknown>
    isMember = false

    const refreshed = await fetch(`${baseUrl}/api/client-auth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${loginBody.appSessionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ providerToken: 'valid-neon-token' }),
    })

    expect(refreshed.status).toBe(403)
    expect(await refreshed.json()).toEqual({
      error: 'Invitation required',
      code: 'invitation_required',
    })
  })

  it('issues an isolated five-minute Skills Market publish capability', async () => {
    const { baseUrl } = await createServer({
      neonAuth: createNeonAuthConfig({ organizationId: 'org_storyflow' }),
    })
    const login = await fetch(`${baseUrl}/api/client-auth/neon/exchange`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-neon-token' },
    })
    const loginBody = await login.json() as Record<string, unknown>

    const issued = await fetch(`${baseUrl}/api/client-auth/skills-market/token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${loginBody.appSessionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ providerToken: 'valid-neon-token' }),
    })

    expect(issued.status).toBe(200)
    const body = await issued.json() as Record<string, unknown>
    expect(body.expiresInSeconds).toBe(300)
    const { payload } = await jwtVerify(
      body.marketPublishToken as string,
      new TextEncoder().encode(SKILLS_MARKET_SECRET),
      {
        algorithms: ['HS256'],
        issuer: 'storyflow-auth-broker',
        audience: 'storyflow-skills-market',
      },
    )
    expect(payload.sub).toBe('neon:neon_user_123')
    expect(payload.scopes).toEqual(['skills:read', 'skills:publish'])
    expect(payload.organization_id).toBe('org_storyflow')
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(300)
    expect(payload.model_tier).toBeUndefined()
  })

  it('rejects refresh after the absolute client-session lifetime', async () => {
    const { baseUrl } = await createServer()
    const now = Math.floor(Date.now() / 1000)
    const expiredByPolicy = await new SignJWT({
      scope: 'model:issue',
      model_tier: 'standard',
      auth_time: now - 31 * 24 * 60 * 60,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid: CLIENT_SESSION_KEY_ID })
      .setIssuer('storyflow-auth-broker')
      .setAudience('storyflow-client-auth')
      .setSubject('neon:neon_user_123')
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(new TextEncoder().encode(CLIENT_SESSION_SECRET))

    const res = await fetch(`${baseUrl}/api/client-auth/token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${expiredByPolicy}` },
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: 'Invalid client session token',
      code: 'client_session_token_invalid',
    })
  })

  it('rejects invalid client sessions with a stable machine code', async () => {
    const { baseUrl } = await createServer()

    const res = await fetch(`${baseUrl}/api/client-auth/token`, {
      method: 'POST',
      headers: { Authorization: 'Bearer invalid-session' },
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: 'Invalid client session token',
      code: 'client_session_token_invalid',
    })
  })

  it('does not accept the RPC/Web UI secret as a client-session signing key', async () => {
    const { baseUrl } = await createServer()
    const forged = await createClientSessionToken(
      { id: CLIENT_SESSION_KEY_ID, secret: SECRET },
      'attacker',
      'pro',
    )

    const res = await fetch(`${baseUrl}/api/client-auth/token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${forged}` },
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: 'Invalid client session token',
      code: 'client_session_token_invalid',
    })
  })

  it('rejects a broker configured to reuse a shared RPC secret', async () => {
    await expect(createServer({
      clientSessionTokenSecret: SECRET,
    })).rejects.toThrow('pairwise distinct')
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
