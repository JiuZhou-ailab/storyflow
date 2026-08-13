// input: Browser and desktop Neon exchange requests with an unverified identity
// output: Fail-closed session and model-capability issuance assertions
// pos: Regression coverage for the shared Neon session-creation trust boundary

import { describe, expect, it } from 'bun:test'
import { jwtVerify } from 'jose'
import { createClientSessionToken } from '../auth'
import { createWebuiHandler } from '../http-server'

const CLIENT_KEY = { id: 'client-current', secret: 'client-session-secret' }
const MODEL_KEY = { id: 'model-current', secret: 'model-access-secret' }
const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as any

describe('Neon exchange boundary', () => {
  it('does not create browser or model sessions for unverified identities', async () => {
    const handler = createWebuiHandler({
      webuiDir: '/nonexistent',
      secret: 'rpc-session-secret',
      wsProtocol: 'ws',
      wsPort: 9100,
      getHealthCheck: () => ({ status: 'ok' }),
      logger,
      neonAuth: {
        baseUrl: 'https://ep-test.neonauth.aws.neon.build/neondb/auth',
        tokenVerifier: async () => ({
          sub: 'unverified-user',
          email: 'unverified@example.com',
          emailVerified: false,
        }),
      },
      clientSessionTokenKeyRing: {
        current: CLIENT_KEY,
      },
      modelAccessTokenKey: MODEL_KEY,
    })

    try {
      const requests = [
        new Request('http://localhost/api/auth/neon/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'unverified-token' }),
        }),
        new Request('http://localhost/api/client-auth/neon/exchange', {
          method: 'POST',
          headers: { Authorization: 'Bearer unverified-token' },
        }),
      ]

      for (const request of requests) {
        const response = await handler.fetch(request)
        expect(response.status).toBe(401)
        expect(response.headers.get('set-cookie')).toBeNull()
        expect(await response.json()).toEqual({ error: 'Email verification is required' })
      }
    } finally {
      handler.dispose()
    }
  })

  it('does not create a browser session when email sign-in returns an unverified identity', async () => {
    const handler = createWebuiHandler({
      webuiDir: '/nonexistent',
      secret: 'rpc-session-secret',
      wsProtocol: 'ws',
      wsPort: 9100,
      getHealthCheck: () => ({ status: 'ok' }),
      logger,
      neonAuth: {
        baseUrl: 'https://ep-test.neonauth.aws.neon.build/neondb/auth',
        fetch: async () => Response.json({
          data: {
            session: { access_token: 'unverified-token' },
            user: { id: 'unverified-user', emailVerified: false },
          },
        }),
        tokenVerifier: async () => ({
          sub: 'unverified-user',
          email: 'unverified@example.com',
          emailVerified: false,
        }),
      },
    })

    try {
      const response = await handler.fetch(new Request('http://localhost/api/auth/neon/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'sign-in',
          email: 'unverified@example.com',
          password: 'secret-password',
        }),
      }))

      expect(response.status).toBe(401)
      expect(response.headers.get('set-cookie')).toBeNull()
      expect(await response.json()).toEqual({ error: 'Email verification is required' })
    } finally {
      handler.dispose()
    }
  })

  it('never issues a model capability beyond its parent session', async () => {
    const handler = createWebuiHandler({
      webuiDir: '/nonexistent',
      secret: 'rpc-session-secret',
      wsProtocol: 'ws',
      wsPort: 9100,
      getHealthCheck: () => ({ status: 'ok' }),
      logger,
      neonAuth: {
        baseUrl: 'https://ep-test.neonauth.aws.neon.build/neondb/auth',
        organizationId: 'org_storyflow',
        tokenVerifier: async token => token === 'valid-neon-token'
          ? {
              sub: 'user-1',
              email: 'member@example.com',
              emailVerified: true,
              o: { id: 'org_storyflow', role: 'member' },
            }
          : null,
      },
      clientSessionTokenKeyRing: { current: CLIENT_KEY },
      modelAccessTokenKey: MODEL_KEY,
    })
    const now = Math.floor(Date.now() / 1000)

    try {
      const nearExpiry = await createClientSessionToken(
        CLIENT_KEY,
        'neon:user-1',
        'standard',
        now - 90 * 24 * 60 * 60 + 12 * 60 * 60,
      )
      const rejected = await handler.fetch(new Request('http://localhost/api/client-auth/token', {
        method: 'POST',
        headers: { Authorization: `Bearer ${nearExpiry}` },
      }))
      expect(rejected.status).toBe(401)

      const renewable = await createClientSessionToken(
        CLIENT_KEY,
        'neon:user-1',
        'standard',
        now - 90 * 24 * 60 * 60 + 12 * 60 * 60 + 10 * 60,
      )
      const refreshed = await handler.fetch(new Request('http://localhost/api/client-auth/token', {
        method: 'POST',
        headers: { Authorization: `Bearer ${renewable}` },
      }))
      expect(refreshed.status).toBe(200)
      const body = await refreshed.json() as Record<string, string>
      const parent = await jwtVerify(body.appSessionToken, new TextEncoder().encode(CLIENT_KEY.secret))
      const child = await jwtVerify(body.modelAccessToken, new TextEncoder().encode(MODEL_KEY.secret))
      expect(child.payload.exp as number).toBeLessThanOrEqual(parent.payload.exp as number)
    } finally {
      handler.dispose()
    }
  })
})
