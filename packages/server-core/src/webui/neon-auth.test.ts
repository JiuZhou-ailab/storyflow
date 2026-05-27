// input: Neon Auth bridge configuration and injected token verifier behavior.
// output: Contract tests for normalized Neon Auth identities and public client config.
// pos: Test coverage for the Web UI email-auth identity boundary.

import { describe, expect, it } from 'bun:test'
import { NeonAuthService } from './neon-auth'

describe('NeonAuthService', () => {
  it('reports disabled client config when no base URL is provided', () => {
    const service = new NeonAuthService(undefined)

    expect(service.isConfigured()).toBe(false)
    expect(service.getClientConfig()).toEqual({ enabled: false })
  })

  it('exposes only the public Neon Auth base URL to the browser', () => {
    const service = new NeonAuthService({
      baseUrl: ' https://ep-test.neonauth.aws.neon.build/neondb/auth/ ',
      jwksUrl: 'https://example.com/private-jwks',
      issuer: 'https://issuer.example.com',
      audience: 'https://audience.example.com',
    })

    expect(service.isConfigured()).toBe(true)
    expect(service.getClientConfig()).toEqual({
      enabled: true,
      baseUrl: 'https://ep-test.neonauth.aws.neon.build/neondb/auth',
    })
  })

  it('normalizes a valid Neon Auth token payload into an app identity', async () => {
    const service = new NeonAuthService({
      baseUrl: 'https://ep-test.neonauth.aws.neon.build/neondb/auth',
      tokenVerifier: async (token) => {
        expect(token).toBe('valid-token')
        return {
          sub: 'user_123',
          email: 'Person@Example.com',
          emailVerified: true,
          name: 'Example Person',
        }
      },
    })

    await expect(service.verifyToken('valid-token')).resolves.toEqual({
      provider: 'neon',
      userId: 'user_123',
      subject: 'neon:user_123',
      email: 'person@example.com',
      emailVerified: true,
      name: 'Example Person',
    })
  })

  it('rejects token payloads without a stable user id', async () => {
    const service = new NeonAuthService({
      baseUrl: 'https://ep-test.neonauth.aws.neon.build/neondb/auth',
      tokenVerifier: async () => ({
        email: 'missing-id@example.com',
      }),
    })

    await expect(service.verifyToken('invalid-token')).rejects.toThrow('Neon Auth token did not include a subject')
  })

  it('rejects banned Neon Auth users', async () => {
    const service = new NeonAuthService({
      baseUrl: 'https://ep-test.neonauth.aws.neon.build/neondb/auth',
      tokenVerifier: async () => ({
        sub: 'user_banned',
        email: 'banned@example.com',
        banned: true,
      }),
    })

    await expect(service.verifyToken('banned-token')).rejects.toThrow('Neon Auth user is banned')
  })

  it('posts email sign-in to the Neon Auth password endpoint', async () => {
    const requests: Array<{ url: string, init?: RequestInit }> = []
    const service = new NeonAuthService({
      baseUrl: 'https://ep-test.neonauth.aws.neon.build/neondb/auth',
      fetch: async (input, init) => {
        requests.push({ url: String(input), init })
        return Response.json({
          data: {
            session: { access_token: 'neon-access-token' },
            user: {
              id: 'user_from_signin',
              email: 'signin@example.com',
              emailVerified: true,
            },
          },
        })
      },
    })

    await expect(service.authenticateWithEmailPassword({
      mode: 'sign-in',
      email: 'signin@example.com',
      password: 'secret-password',
      origin: 'https://craft.example.com',
    })).resolves.toEqual({
      status: 'authenticated',
      token: 'neon-access-token',
      user: {
        id: 'user_from_signin',
        email: 'signin@example.com',
        emailVerified: true,
      },
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('https://ep-test.neonauth.aws.neon.build/neondb/auth/sign-in/email')
    expect(requests[0]?.init?.method).toBe('POST')
    expect(requests[0]?.init?.headers).toEqual({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: 'https://craft.example.com',
    })
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      email: 'signin@example.com',
      password: 'secret-password',
    })
  })

  it('maps username sign-in identifiers to the configured internal email domain', async () => {
    const requests: Array<{ url: string, init?: RequestInit }> = []
    const service = new NeonAuthService({
      baseUrl: 'https://ep-test.neonauth.aws.neon.build/neondb/auth',
      usernameEmailDomain: ' users.craft.invalid ',
      fetch: async (input, init) => {
        requests.push({ url: String(input), init })
        return Response.json({
          data: {
            session: { access_token: 'username-access-token' },
            user: {
              id: 'user_from_username',
              email: 'zjding@users.craft.invalid',
              emailVerified: true,
            },
          },
        })
      },
    })

    await expect(service.authenticateWithEmailPassword({
      mode: 'sign-in',
      email: 'zjding',
      password: 'secret-password',
    })).resolves.toEqual({
      status: 'authenticated',
      token: 'username-access-token',
      user: {
        id: 'user_from_username',
        email: 'zjding@users.craft.invalid',
        emailVerified: true,
      },
    })

    expect(service.getClientConfig()).toEqual({
      enabled: true,
      baseUrl: 'https://ep-test.neonauth.aws.neon.build/neondb/auth',
      usernameLoginEnabled: true,
    })
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      email: 'zjding@users.craft.invalid',
      password: 'secret-password',
    })
  })

  it('exchanges a Neon Auth session cookie for a JWT when email sign-in returns an opaque token', async () => {
    const requests: Array<{ url: string, init?: RequestInit }> = []
    const service = new NeonAuthService({
      baseUrl: 'https://ep-test.neonauth.aws.neon.build/neondb/auth',
      fetch: async (input, init) => {
        requests.push({ url: String(input), init })
        if (String(input).endsWith('/token')) {
          expect(init?.method).toBe('GET')
          expect((init?.headers as Record<string, string>).Cookie).toBe('__Secure-neon-auth.session_token=opaque-session-token')
          return Response.json({ token: 'jwt-access-token' })
        }

        return Response.json({
          token: 'opaque-session-token',
          user: {
            id: 'user_from_cookie_session',
            email: 'cookie.session@example.com',
            emailVerified: true,
          },
        }, {
          headers: {
            'Set-Cookie': '__Secure-neon-auth.session_token=opaque-session-token; Path=/; HttpOnly; Secure; SameSite=None',
          },
        })
      },
    })

    await expect(service.authenticateWithEmailPassword({
      mode: 'sign-in',
      email: 'cookie.session@example.com',
      password: 'secret-password',
    })).resolves.toEqual({
      status: 'authenticated',
      token: 'jwt-access-token',
      user: {
        id: 'user_from_cookie_session',
        email: 'cookie.session@example.com',
        emailVerified: true,
      },
    })
    expect(requests.map((request) => request.url)).toEqual([
      'https://ep-test.neonauth.aws.neon.build/neondb/auth/sign-in/email',
      'https://ep-test.neonauth.aws.neon.build/neondb/auth/token',
    ])
  })

  it('posts email sign-up and reports verification-required when Neon Auth does not return a session token', async () => {
    const service = new NeonAuthService({
      baseUrl: 'https://ep-test.neonauth.aws.neon.build/neondb/auth',
      fetch: async () => Response.json({
        data: {
          user: {
            id: 'user_from_signup',
            email: 'signup@example.com',
            emailVerified: false,
          },
        },
      }),
    })

    await expect(service.authenticateWithEmailPassword({
      mode: 'sign-up',
      email: 'signup@example.com',
      password: 'secret-password',
      name: 'Signup User',
      callbackURL: 'https://craft.example.com/login',
    })).resolves.toEqual({
      status: 'verification-required',
      user: {
        id: 'user_from_signup',
        email: 'signup@example.com',
        emailVerified: false,
      },
    })
  })

  it('surfaces Neon Auth email password errors', async () => {
    const service = new NeonAuthService({
      baseUrl: 'https://ep-test.neonauth.aws.neon.build/neondb/auth',
      fetch: async () => Response.json({
        error: {
          message: 'Invalid email or password',
        },
      }, { status: 401 }),
    })

    await expect(service.authenticateWithEmailPassword({
      mode: 'sign-in',
      email: 'signin@example.com',
      password: 'wrong-password',
    })).rejects.toThrow('Invalid email or password')
  })
})
