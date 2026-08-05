// input: Electron client auth config, mocked Neon Auth service, and broker callbacks.
// output: Contract tests for desktop auth state, registration, persistence, and broker login.
// pos: Main-process regression coverage for the desktop auth gate boundary.

import { describe, expect, it } from 'bun:test'
import {
  createClientAuthConfigFromEnv,
  createClientAuthConfigFromRuntimeEnv,
  createClientAuthService,
  type ClientAuthBrokerClient,
  type ClientAuthBrokerExchangeResult,
  type ClientAuthBrokerTokenRefreshResult,
  type ClientAuthNeonService,
} from '../client-auth'

function modelToken(expiresAtMs: number): string {
  return [
    Buffer.from('{}').toString('base64url'),
    Buffer.from(JSON.stringify({ exp: expiresAtMs / 1000 })).toString('base64url'),
    'signature',
  ].join('.')
}

const unusedBrokerMethods: ClientAuthBrokerClient = {
  exchangeNeonToken: async () => { throw new Error('not used') },
  exchangeFeishuCode: async () => { throw new Error('not used') },
  refreshModelAccessToken: async () => { throw new Error('not used') },
}

const unusedNeonOrganizationMethods = {
  verifyEmailOtp: async () => {},
  getSessionToken: async () => { throw new Error('not used') },
  getOrganizationToken: async () => { throw new Error('not used') },
}

function neonBroker(user: ClientAuthBrokerExchangeResult['user']): ClientAuthBrokerClient {
  return {
    ...unusedBrokerMethods,
    exchangeNeonToken: async () => ({
      user,
      appSessionToken: 'app-session-token',
      modelAccessToken: 'model-access-token',
    }),
  }
}

describe('client auth', () => {
  it('keeps shell access separate from managed-account authentication', () => {
    const service = createClientAuthService({ required: false })
    expect(service.getState()).toEqual({
      required: false,
      configured: false,
      authenticated: false,
      emailPasswordEnabled: false,
      emailSignUpEnabled: false,
      feishuLoginEnabled: false,
    })
  })

  it('keeps packaged local workspace access available by default', () => {
    const config = createClientAuthConfigFromEnv({
      CRAFT_IS_PACKAGED: '1',
    })
    const service = createClientAuthService(config)
    expect(service.getState()).toEqual({
      required: false,
      configured: false,
      authenticated: false,
      emailPasswordEnabled: false,
      emailSignUpEnabled: false,
      feishuLoginEnabled: false,
    })
  })

  it('allows explicitly disabling client auth in packaged runtime', () => {
    const config = createClientAuthConfigFromEnv({
      CRAFT_IS_PACKAGED: '1',
      CRAFT_CLIENT_AUTH_REQUIRED: 'false',
    })
    const service = createClientAuthService(config)
    expect(service.getState()).toEqual({
      required: false,
      configured: false,
      authenticated: false,
      emailPasswordEnabled: false,
      emailSignUpEnabled: false,
      feishuLoginEnabled: false,
    })
  })

  it('uses bundled auth values when runtime process env is empty in packaged builds', () => {
    const config = createClientAuthConfigFromRuntimeEnv({}, {
      CRAFT_CLIENT_AUTH_REQUIRED: 'true',
      CRAFT_CLIENT_AUTH_BROKER_URL: 'https://auth.storyflow.example.com',
      CRAFT_CLIENT_FEISHU_APP_ID: 'cli_test',
      CRAFT_CLIENT_NEON_AUTH_BASE_URL: 'https://auth.example.com',
      CRAFT_CLIENT_NEON_AUTH_USERNAME_EMAIL_DOMAIN: 'users.craft.invalid',
    })
    expect(config.required).toBe(true)
    expect(config.authBrokerUrl).toBe('https://auth.storyflow.example.com')
    expect(config.feishuBrokerAuth?.appId).toBe('cli_test')
    expect(config.neonAuth?.baseUrl).toBe('https://auth.example.com')
    expect(config.neonAuth?.usernameEmailDomain).toBe('users.craft.invalid')
  })

  it('does not let empty runtime env values erase bundled auth config', () => {
    const config = createClientAuthConfigFromRuntimeEnv({
      CRAFT_CLIENT_AUTH_BROKER_URL: '',
      CRAFT_CLIENT_FEISHU_APP_ID: '',
    }, {
      CRAFT_CLIENT_AUTH_REQUIRED: 'true',
      CRAFT_CLIENT_AUTH_BROKER_URL: 'https://auth.storyflow.example.com',
      CRAFT_CLIENT_FEISHU_APP_ID: 'cli_test',
    })
    expect(config.authBrokerUrl).toBe('https://auth.storyflow.example.com')
    expect(config.feishuBrokerAuth?.appId).toBe('cli_test')
  })

  it('blocks required auth when Neon Auth is not configured', async () => {
    const service = createClientAuthService({ required: true })
    expect(service.getState()).toEqual({
      required: true,
      configured: false,
      authenticated: false,
      emailPasswordEnabled: false,
      emailSignUpEnabled: false,
      feishuLoginEnabled: false,
    })
    await expect(service.signIn({ identifier: 'zjding', password: 'secret' }))
      .rejects
      .toThrow('Client auth is not configured')
  })

  it('does not expose Neon login when the renewable-session broker is missing', async () => {
    const service = createClientAuthService({
      required: true,
      neonAuth: { baseUrl: 'https://auth.example.com' },
    })

    expect(service.getState()).toMatchObject({
      configured: false,
      authenticated: false,
      emailPasswordEnabled: false,
    })
    await expect(service.signIn({ identifier: 'user@example.com', password: 'secret' }))
      .rejects
      .toThrow('Client auth is not configured')
  })

  it('stores the verified Neon Auth identity after password sign-in', async () => {
    const calls: Array<{ email: string, password: string, origin?: string }> = []
    const fakeNeonAuth: ClientAuthNeonService = {
      ...unusedNeonOrganizationMethods,
      isConfigured: () => true,
      getClientConfig: () => ({
        enabled: true,
        baseUrl: 'https://auth.example.com',
        usernameLoginEnabled: true,
      }),
      authenticateWithEmailPassword: async (input) => {
        calls.push({
          email: input.email,
          password: input.password,
          origin: input.origin,
        })
        return { status: 'authenticated', token: 'jwt-token' }
      },
      verifyToken: async (token) => {
        expect(token).toBe('jwt-token')
        return {
          provider: 'neon',
          userId: 'user-1',
          subject: 'neon:user-1',
          email: 'zjding@users.craft.invalid',
          emailVerified: true,
          name: 'zjding',
        }
      },
    }

    const service = createClientAuthService({
      required: true,
      neonAuthOrigin: 'http://localhost:9100',
      authBrokerUrl: 'https://auth.storyflow.example.com',
      neonAuth: {
        baseUrl: 'https://auth.example.com',
        usernameEmailDomain: 'users.craft.invalid',
      },
    }, {
      createNeonAuthService: () => fakeNeonAuth,
      createAuthBrokerClient: () => neonBroker({
        provider: 'neon',
        userId: 'user-1',
        email: 'zjding@users.craft.invalid',
        emailVerified: true,
        name: 'zjding',
      }),
    })

    const signedIn = await service.signIn({ identifier: 'zjding', password: 'secret' })

    expect(calls).toEqual([
      { email: 'zjding', password: 'secret', origin: 'http://localhost:9100' },
    ])
    expect(signedIn).toEqual({
      provider: 'neon',
      userId: 'user-1',
      email: 'zjding@users.craft.invalid',
      emailVerified: true,
      name: 'zjding',
    })
    expect(service.getState()).toEqual({
      required: true,
      configured: true,
      authenticated: true,
      emailPasswordEnabled: true,
      emailSignUpEnabled: false,
      feishuLoginEnabled: false,
      usernameLoginEnabled: true,
      user: signedIn,
    })
  })

  it('keeps email sign-up disabled unless the desktop config explicitly enables it', async () => {
    const calls: Array<{ mode: string }> = []
    const fakeNeonAuth: ClientAuthNeonService = {
      ...unusedNeonOrganizationMethods,
      isConfigured: () => true,
      getClientConfig: () => ({ enabled: true, emailSignUpEnabled: false }),
      authenticateWithEmailPassword: async (input) => {
        calls.push({ mode: input.mode })
        return { status: 'authenticated', token: 'unexpected-token' }
      },
      verifyToken: async () => {
        throw new Error('verifyToken should not be called')
      },
    }
    const service = createClientAuthService(
      {
        required: true,
        authBrokerUrl: 'https://auth.storyflow.example.com',
        neonAuth: { baseUrl: 'https://auth.example.com' },
      },
      {
        createNeonAuthService: () => fakeNeonAuth,
        createAuthBrokerClient: () => neonBroker({ provider: 'neon', userId: 'pending-user' }),
      },
    )

    expect(service.getState()).toEqual({
      required: true,
      configured: true,
      authenticated: false,
      emailPasswordEnabled: true,
      emailSignUpEnabled: false,
      feishuLoginEnabled: false,
    })
    await expect(service.signUp({
      identifier: 'new@example.com',
      password: 'secret',
    })).rejects.toThrow('Email sign-up is disabled')
    expect(calls).toEqual([])
  })

  it('restores a persisted desktop auth session on process start', () => {
    const service = createClientAuthService({
      required: true,
      authBrokerUrl: 'https://auth.storyflow.example.com',
    }, {
      createAuthBrokerClient: () => unusedBrokerMethods,
      initialSession: {
        user: {
          provider: 'neon',
          userId: 'user-1',
          email: 'user@example.com',
        },
        appSessionToken: 'app-session-token',
        modelAccessToken: 'model-access-token',
      },
    })

    expect(service.getState()).toEqual({
      required: true,
      configured: false,
      authenticated: true,
      emailPasswordEnabled: false,
      emailSignUpEnabled: false,
      feishuLoginEnabled: false,
      user: {
        provider: 'neon',
        userId: 'user-1',
        email: 'user@example.com',
      },
    })
  })

  it('uses the renewable app session, not a model-token projection, as required-auth identity', () => {
    const legacyService = createClientAuthService({ required: true }, {
      initialSession: {
        user: {
          provider: 'neon',
          userId: 'user-1',
        },
        modelAccessToken: 'legacy-model-token',
      },
    })
    const renewableService = createClientAuthService({
      required: true,
      authBrokerUrl: 'https://auth.storyflow.example.com',
    }, {
      createAuthBrokerClient: () => unusedBrokerMethods,
      initialSession: {
        user: {
          provider: 'neon',
          userId: 'user-1',
        },
        appSessionToken: 'app-session-token',
      },
    })

    expect(legacyService.getState().authenticated).toBe(false)
    expect(renewableService.getState().authenticated).toBe(true)
  })

  it('persists and clears the desktop auth session around password sign-in', async () => {
    const savedSessions: unknown[] = []
    let clearCount = 0
    const fakeNeonAuth: ClientAuthNeonService = {
      ...unusedNeonOrganizationMethods,
      isConfigured: () => true,
      getClientConfig: () => ({ enabled: true }),
      authenticateWithEmailPassword: async () => ({ status: 'authenticated', token: 'jwt-token' }),
      verifyToken: async () => ({
        provider: 'neon',
        userId: 'user-1',
        subject: 'neon:user-1',
        email: 'user@example.com',
      }),
    }

    const service = createClientAuthService({
      required: true,
      authBrokerUrl: 'https://auth.storyflow.example.com',
      neonAuth: { baseUrl: 'https://auth.example.com' },
    }, {
      createNeonAuthService: () => fakeNeonAuth,
      createAuthBrokerClient: () => neonBroker({
        provider: 'neon',
        userId: 'user-1',
        email: 'user@example.com',
      }),
      sessionStore: {
        save: async (session) => { savedSessions.push(session) },
        clear: async () => { clearCount += 1 },
      },
    })

    await service.signIn({ identifier: 'user@example.com', password: 'secret' })
    await service.signOut()

    expect(savedSessions).toEqual([{
      user: {
        provider: 'neon',
        userId: 'user-1',
        email: 'user@example.com',
      },
      appSessionToken: 'app-session-token',
      modelAccessToken: 'model-access-token',
    }])
    expect(clearCount).toBe(1)
    expect(service.getState().authenticated).toBe(false)
  })

  it('rejects a Neon broker login without a renewable app session', async () => {
    const fakeNeonAuth: ClientAuthNeonService = {
      ...unusedNeonOrganizationMethods,
      isConfigured: () => true,
      getClientConfig: () => ({ enabled: true }),
      authenticateWithEmailPassword: async () => ({ status: 'authenticated', token: 'jwt-token' }),
      verifyToken: async () => ({
        provider: 'neon',
        userId: 'user-1',
        subject: 'neon:user-1',
      }),
    }
    let saveCount = 0
    const service = createClientAuthService({
      required: true,
      neonAuth: { baseUrl: 'https://auth.example.com' },
      authBrokerUrl: 'https://auth.storyflow.example.com',
    }, {
      createNeonAuthService: () => fakeNeonAuth,
      createAuthBrokerClient: () => ({
        ...unusedBrokerMethods,
        exchangeNeonToken: async () => ({
          user: { provider: 'neon', userId: 'user-1' },
          modelAccessToken: 'model-access-token',
        }),
      }),
      sessionStore: {
        save: async () => { saveCount += 1 },
        clear: async () => {},
      },
    })

    await expect(service.signIn({ identifier: 'user@example.com', password: 'secret' }))
      .rejects
      .toThrow('app session token')
    expect(saveCount).toBe(0)
    expect(service.getState().authenticated).toBe(false)
  })

  it('registers a Neon Auth email account and signs in when the provider returns a token', async () => {
    const events: string[] = []
    const calls: Array<{ mode: string, email: string, password: string, name?: string, origin?: string }> = []
    const fakeNeonAuth: ClientAuthNeonService = {
      ...unusedNeonOrganizationMethods,
      isConfigured: () => true,
      getClientConfig: () => ({ enabled: true, emailSignUpEnabled: true }),
      authenticateWithEmailPassword: async (input) => {
        events.push('neon-sign-up')
        calls.push({
          mode: input.mode,
          email: input.email,
          password: input.password,
          name: input.name,
          origin: input.origin,
        })
        return {
          status: 'authenticated',
          token: 'opaque-signup-token',
          sessionCookie: 'neon-session-cookie',
        }
      },
      getSessionToken: async (input) => {
        events.push('neon-session-token')
        expect(input).toEqual({
          sessionCookie: 'neon-session-cookie',
          origin: 'http://localhost:9100',
        })
        return 'signup-jwt-token'
      },
      verifyToken: async (token) => {
        expect(token).toBe('signup-jwt-token')
        return {
          provider: 'neon',
          userId: 'user-registered',
          subject: 'neon:user-registered',
          email: 'new@example.com',
          emailVerified: true,
          name: 'New User',
        }
      },
    }
    const service = createClientAuthService({
      required: true,
      neonAuthOrigin: 'http://localhost:9100',
      authBrokerUrl: 'https://auth.storyflow.example.com',
      neonAuth: { baseUrl: 'https://auth.example.com', emailSignUpEnabled: true },
    }, {
      createNeonAuthService: () => fakeNeonAuth,
      createAuthBrokerClient: () => ({
        ...unusedBrokerMethods,
        exchangeNeonToken: async (input) => {
          events.push('exchange')
          expect(input.token).toBe('signup-jwt-token')
          return {
            user: {
              provider: 'neon',
              userId: 'user-registered',
              email: 'new@example.com',
              emailVerified: true,
              name: 'New User',
            },
            appSessionToken: 'app-session-token',
            modelAccessToken: 'model-access-token',
          }
        },
      }),
    })

    const result = await service.signUp({
      identifier: 'new@example.com',
      password: 'secret',
      name: 'New User',
    })

    expect(calls).toEqual([{
      mode: 'sign-up',
      email: 'new@example.com',
      password: 'secret',
      name: 'New User',
      origin: 'http://localhost:9100',
    }])
    expect(result).toEqual({
      status: 'authenticated',
      user: {
        provider: 'neon',
        userId: 'user-registered',
        email: 'new@example.com',
        emailVerified: true,
        name: 'New User',
      },
    })
    expect(service.getState().authenticated).toBe(true)
    expect(events).toEqual(['neon-sign-up', 'neon-session-token', 'exchange'])
  })

  it('keeps the client unauthenticated when Neon Auth registration requires email verification', async () => {
    const fakeNeonAuth: ClientAuthNeonService = {
      ...unusedNeonOrganizationMethods,
      isConfigured: () => true,
      getClientConfig: () => ({ enabled: true, emailSignUpEnabled: true }),
      authenticateWithEmailPassword: async () => ({
        status: 'verification-required',
        user: {
          id: 'pending-user',
          email: 'pending@example.com',
          emailVerified: false,
          name: 'Pending User',
        },
      }),
      verifyToken: async () => {
        throw new Error('verifyToken should not be called')
      },
    }
    const service = createClientAuthService(
      {
        required: true,
        authBrokerUrl: 'https://auth.storyflow.example.com',
        neonAuth: { baseUrl: 'https://auth.example.com', emailSignUpEnabled: true },
      },
      {
        createNeonAuthService: () => fakeNeonAuth,
        createAuthBrokerClient: () => neonBroker({ provider: 'neon', userId: 'pending-user' }),
      },
    )

    const result = await service.signUp({
      identifier: 'pending@example.com',
      password: 'secret',
      name: 'Pending User',
    })

    expect(result).toEqual({
      status: 'verification-required',
      user: {
        provider: 'neon',
        userId: 'pending-user',
        email: 'pending@example.com',
        emailVerified: false,
        name: 'Pending User',
      },
    })
    expect(service.getState().authenticated).toBe(false)
  })

  it('delegates email verification to Neon Auth without exposing the session cookie', async () => {
    let verificationInput: unknown
    const service = createClientAuthService({
      required: true,
      authBrokerUrl: 'https://auth.storyflow.example.com',
      neonAuthOrigin: 'http://localhost:9100',
      neonAuth: { baseUrl: 'https://auth.example.com', emailSignUpEnabled: true },
    }, {
      createNeonAuthService: () => ({
        ...unusedNeonOrganizationMethods,
        isConfigured: () => true,
        getClientConfig: () => ({ enabled: true, emailSignUpEnabled: true }),
        authenticateWithEmailPassword: async () => { throw new Error('not used') },
        verifyEmailOtp: async (input) => { verificationInput = input },
        verifyToken: async () => { throw new Error('not used') },
      }),
      createAuthBrokerClient: () => unusedBrokerMethods,
    })

    await service.verifyEmailOtp({ email: 'invitee@example.com', otp: '123456' })
    expect(verificationInput).toEqual({
      email: 'invitee@example.com',
      otp: '123456',
      origin: 'http://localhost:9100',
    })
  })

  it('keeps the client unauthenticated when sign-up does not prove email verification', async () => {
    const fakeNeonAuth: ClientAuthNeonService = {
      ...unusedNeonOrganizationMethods,
      isConfigured: () => true,
      getClientConfig: () => ({ enabled: true, emailSignUpEnabled: true }),
      authenticateWithEmailPassword: async () => ({ status: 'authenticated', token: 'signup-jwt-token' }),
      verifyToken: async (token) => {
        expect(token).toBe('signup-jwt-token')
        return {
          provider: 'neon',
          userId: 'pending-user',
          subject: 'neon:pending-user',
          email: 'pending@example.com',
          name: 'Pending User',
        }
      },
    }
    const service = createClientAuthService(
      {
        required: true,
        authBrokerUrl: 'https://auth.storyflow.example.com',
        neonAuth: { baseUrl: 'https://auth.example.com', emailSignUpEnabled: true },
      },
      {
        createNeonAuthService: () => fakeNeonAuth,
        createAuthBrokerClient: () => neonBroker({ provider: 'neon', userId: 'pending-user' }),
      },
    )

    const result = await service.signUp({
      identifier: 'pending@example.com',
      password: 'secret',
      name: 'Pending User',
    })

    expect(result).toEqual({
      status: 'verification-required',
      user: {
        provider: 'neon',
        userId: 'pending-user',
        email: 'pending@example.com',
        name: 'Pending User',
      },
    })
    expect(service.getState().authenticated).toBe(false)
  })

  it('silently refreshes a stale model token and persists rotated broker tokens', async () => {
    const now = Date.UTC(2026, 6, 27)
    const refreshedModelToken = modelToken(now + 15 * 60 * 1000)
    const savedSessions: unknown[] = []
    const changes: unknown[] = []
    const scheduledDelays: number[] = []
    let cancelCount = 0
    let refreshCount = 0
    const broker: ClientAuthBrokerClient = {
      ...unusedBrokerMethods,
      refreshModelAccessToken: async (input) => {
        refreshCount += 1
        expect(input).toEqual({
          brokerUrl: 'https://auth.storyflow.example.com',
          appSessionToken: 'old-app-session',
          providerToken: 'fresh-provider-token',
        })
        return {
          appSessionToken: 'rotated-app-session',
          modelAccessToken: refreshedModelToken,
        }
      },
    }
    const service = createClientAuthService({
      required: true,
      authBrokerUrl: 'https://auth.storyflow.example.com',
      neonAuth: { baseUrl: 'https://auth.example.com', organizationId: 'org_storyflow' },
    }, {
      createAuthBrokerClient: () => broker,
      createNeonAuthService: () => ({
        ...unusedNeonOrganizationMethods,
        isConfigured: () => true,
        getClientConfig: () => ({ enabled: true }),
        authenticateWithEmailPassword: async () => { throw new Error('not used') },
        verifyToken: async () => { throw new Error('not used') },
        getOrganizationToken: async (input) => {
          expect(input).toEqual({
            sessionCookie: 'neon-session-cookie',
            organizationId: 'org_storyflow',
            origin: undefined,
          })
          return 'fresh-provider-token'
        },
      }),
      initialSession: {
        user: { provider: 'neon', userId: 'user-1' },
        appSessionToken: 'old-app-session',
        neonSessionCookie: 'neon-session-cookie',
        modelAccessToken: modelToken(now + 60_000),
      },
      now: () => now,
      sessionStore: {
        save: async (session) => { savedSessions.push(session) },
        clear: async () => {},
      },
      onAuthChange: async (change) => { changes.push(change) },
      scheduleTimeout: (_callback, delayMs) => { scheduledDelays.push(delayMs); return delayMs },
      cancelTimeout: () => { cancelCount += 1 },
    })
    expect(scheduledDelays).toEqual([0])
    const [result, duplicate] = await Promise.all([
      service.ensureModelAccessToken(),
      service.ensureModelAccessToken(),
    ])
    expect(result).toEqual({ token: refreshedModelToken, refreshed: true })
    expect(duplicate).toEqual(result)
    expect(refreshCount).toBe(1)
    expect(savedSessions).toEqual([{
      user: { provider: 'neon', userId: 'user-1' },
      appSessionToken: 'rotated-app-session',
      modelAccessToken: refreshedModelToken,
      neonSessionCookie: 'neon-session-cookie',
    }])
    expect(changes).toHaveLength(1)
    expect(scheduledDelays.at(-1)).toBe(13 * 60 * 1000)
    service.dispose()
    expect(cancelCount).toBe(2)
  })

  it('issues a Skills Market token without persisting the capability', async () => {
    const savedSessions: unknown[] = []
    const broker: ClientAuthBrokerClient = {
      ...unusedBrokerMethods,
      issueSkillsMarketToken: async (input) => {
        expect(input).toEqual({
          brokerUrl: 'https://auth.storyflow.example.com',
          appSessionToken: 'app-session-token',
        })
        return { marketPublishToken: 'market-publish-token', expiresInSeconds: 300 }
      },
    }
    const service = createClientAuthService({
      required: true,
      authBrokerUrl: 'https://auth.storyflow.example.com',
    }, {
      createAuthBrokerClient: () => broker,
      initialSession: {
        user: { provider: 'feishu', userId: 'user-1' },
        appSessionToken: 'app-session-token',
      },
      sessionStore: {
        save: async session => { savedSessions.push(session) },
        clear: async () => {},
      },
    })

    expect(await service.issueSkillsMarketAccessToken()).toBe('market-publish-token')
    expect(savedSessions).toEqual([])
  })

  it('does not let a fresh non-force preflight swallow a forced gateway retry', async () => {
    const now = Date.UTC(2026, 6, 27)
    const freshToken = modelToken(now + 15 * 60 * 1000)
    const rotatedToken = modelToken(now + 30 * 60 * 1000)
    let refreshCount = 0
    const broker: ClientAuthBrokerClient = {
      ...unusedBrokerMethods,
      refreshModelAccessToken: async () => {
        refreshCount += 1
        return {
          appSessionToken: 'rotated-app-session',
          modelAccessToken: rotatedToken,
        }
      },
    }
    const service = createClientAuthService({
      required: true,
      authBrokerUrl: 'https://auth.storyflow.example.com',
    }, {
      createAuthBrokerClient: () => broker,
      initialSession: {
        user: { provider: 'feishu', userId: 'user-1' },
        appSessionToken: 'old-app-session',
        modelAccessToken: freshToken,
      },
      now: () => now,
    })

    const [normal, forced] = await Promise.all([
      service.ensureModelAccessToken(),
      service.ensureModelAccessToken({ force: true }),
    ])

    expect(normal).toEqual({ token: freshToken, refreshed: false })
    expect(forced).toEqual({ token: rotatedToken, refreshed: true })
    expect(refreshCount).toBe(1)
  })

  it('lets sign-out win over an older in-flight token refresh', async () => {
    let resolveRefresh!: (value: ClientAuthBrokerTokenRefreshResult) => void
    const refreshResponse = new Promise<ClientAuthBrokerTokenRefreshResult>((resolve) => {
      resolveRefresh = resolve
    })
    const savedSessions: unknown[] = []
    const broker: ClientAuthBrokerClient = {
      ...unusedBrokerMethods,
      refreshModelAccessToken: async () => refreshResponse,
    }
    const service = createClientAuthService({
      required: true,
      authBrokerUrl: 'https://auth.storyflow.example.com',
    }, {
      createAuthBrokerClient: () => broker,
      initialSession: {
        user: { provider: 'feishu', userId: 'old-user' },
        appSessionToken: 'old-app-session',
      },
      sessionStore: {
        save: async (session) => { savedSessions.push(session) },
        clear: async () => {},
      },
    })
    const pendingRefresh = service.ensureModelAccessToken()
    await service.signOut()
    resolveRefresh({
      appSessionToken: 'late-app-session',
      modelAccessToken: modelToken(Date.now() + 60 * 60 * 1000),
    })
    await expect(pendingRefresh).rejects.toThrow('session changed')
    expect(savedSessions).toEqual([])
    expect(service.getState().authenticated).toBe(false)
  })

  it('reads Electron client auth config from client env with WebUI Neon fallback, sign-up flag, and a stable Origin', () => {
    const config = createClientAuthConfigFromEnv({
      CRAFT_CLIENT_AUTH_REQUIRED: 'true',
      CRAFT_WEBUI_NEON_AUTH_BASE_URL: 'https://auth.example.com',
      CRAFT_WEBUI_NEON_AUTH_USERNAME_EMAIL_DOMAIN: 'users.craft.invalid',
      CRAFT_WEBUI_NEON_AUTH_ORGANIZATION_ID: 'org_storyflow',
      CRAFT_WEBUI_NEON_AUTH_SIGN_UP_ENABLED: 'true',
    })

    expect(config).toEqual({
      required: true,
      neonAuthOrigin: 'http://localhost:9100',
      neonAuth: {
        baseUrl: 'https://auth.example.com',
        usernameEmailDomain: 'users.craft.invalid',
        organizationId: 'org_storyflow',
        emailSignUpEnabled: true,
      },
    })
  })

  it('prefers the client Neon sign-up flag over the WebUI fallback', () => {
    const config = createClientAuthConfigFromEnv({
      CRAFT_CLIENT_AUTH_REQUIRED: 'true',
      CRAFT_CLIENT_NEON_AUTH_BASE_URL: 'https://auth.example.com',
      CRAFT_CLIENT_NEON_AUTH_SIGN_UP_ENABLED: 'false',
      CRAFT_WEBUI_NEON_AUTH_SIGN_UP_ENABLED: 'true',
    })

    expect(config.neonAuth?.emailSignUpEnabled).toBe(false)
  })

  it('allows overriding the Neon Auth Origin for Electron client sign-in', () => {
    const config = createClientAuthConfigFromEnv({
      CRAFT_CLIENT_AUTH_REQUIRED: 'true',
      CRAFT_CLIENT_NEON_AUTH_BASE_URL: 'https://auth.example.com',
      CRAFT_CLIENT_NEON_AUTH_ORIGIN: 'http://127.0.0.1:3100',
    })

    expect(config.neonAuthOrigin).toBe('http://127.0.0.1:3100')
  })

  it('exchanges Feishu OAuth callbacks through the auth broker instead of a local app secret', async () => {
    const openedUrls: string[] = []
    const exchanges: Array<{
      code: string
      redirectUri: string
      codeVerifier: string
    }> = []
    let callbackState = ''
    let resolveCallback: ((value: { query: Record<string, string> }) => void) | null = null
    const broker: ClientAuthBrokerClient = {
      ...unusedBrokerMethods,
      exchangeFeishuCode: async (input) => {
        exchanges.push({
          code: input.code,
          redirectUri: input.redirectUri,
          codeVerifier: input.codeVerifier,
        })
        expect(input.brokerUrl).toBe('https://auth.storyflow.example.com')
        return {
          user: {
            provider: 'feishu',
            userId: 'ou_broker',
            email: 'broker@example.com',
            name: 'Broker User',
          },
          appSessionToken: 'app-session-token',
          modelAccessToken: 'model-access-token',
        }
      },
    }
    const service = createClientAuthService({
      required: true,
      feishuCallbackPort: 6477,
      feishuBrokerAuth: {
        appId: 'cli_test',
        brokerUrl: 'https://auth.storyflow.example.com',
      },
    }, {
      createAuthBrokerClient: () => broker,
      createCallbackServer: async () => ({
        url: 'http://localhost:6477',
        promise: new Promise((resolve) => {
          resolveCallback = resolve
        }),
        close: () => {},
      }),
      openExternal: async (url) => {
        openedUrls.push(url)
        callbackState = new URL(url).searchParams.get('state') ?? ''
        resolveCallback?.({
          query: {
            code: 'feishu-code',
            state: callbackState,
          },
        })
      },
    })

    const signedIn = await service.signInWithFeishu()

    const openedUrl = new URL(openedUrls[0]!)
    expect(openedUrl.origin + openedUrl.pathname).toBe('https://accounts.feishu.cn/open-apis/authen/v1/authorize')
    expect(openedUrl.searchParams.get('client_id')).toBe('cli_test')
    expect(openedUrl.searchParams.get('redirect_uri')).toBe('http://localhost:6477/callback')
    expect(openedUrl.searchParams.get('code_challenge')).toBeTruthy()
    expect(exchanges).toHaveLength(1)
    expect(exchanges[0]?.code).toBe('feishu-code')
    expect(exchanges[0]?.redirectUri).toBe('http://localhost:6477/callback')
    expect(exchanges[0]?.codeVerifier).toBeTruthy()
    expect(signedIn).toEqual({
      provider: 'feishu',
      userId: 'ou_broker',
      email: 'broker@example.com',
      name: 'Broker User',
    })
    expect(service.getState()).toEqual({
      required: true,
      configured: true,
      authenticated: true,
      emailPasswordEnabled: false,
      emailSignUpEnabled: false,
      feishuLoginEnabled: true,
      user: signedIn,
    })
  })

  it('uses the broker Feishu app id instead of the packaged fallback app id', async () => {
    const openedUrls: string[] = []
    let callbackState = ''
    let resolveCallback: ((value: { query: Record<string, string> }) => void) | null = null
    const broker = {
      ...unusedBrokerMethods,
      getFeishuAuthConfig: async () => ({
        enabled: true,
        appId: 'cli_user_deployment',
      }),
      exchangeFeishuCode: async () => ({
        user: {
          provider: 'feishu' as const,
          userId: 'ou_user',
        },
        appSessionToken: 'app-session-token',
        modelAccessToken: 'model-access-token',
      }),
    }
    const service = createClientAuthService({
      required: true,
      feishuCallbackPort: 6477,
      feishuBrokerAuth: {
        appId: 'cli_packaged_generic',
        brokerUrl: 'https://auth.storyflow.example.com',
      },
    }, {
      createAuthBrokerClient: () => broker,
      createCallbackServer: async () => ({
        url: 'http://localhost:6477',
        promise: new Promise((resolve) => {
          resolveCallback = resolve
        }),
        close: () => {},
      }),
      openExternal: async (url) => {
        openedUrls.push(url)
        callbackState = new URL(url).searchParams.get('state') ?? ''
        resolveCallback?.({
          query: {
            code: 'feishu-code',
            state: callbackState,
          },
        })
      },
    })

    await service.signInWithFeishu()

    const openedUrl = new URL(openedUrls[0]!)
    expect(openedUrl.searchParams.get('client_id')).toBe('cli_user_deployment')
  })

  it('rejects a Feishu broker login without a renewable app session', async () => {
    let callbackState = ''
    let resolveCallback: ((value: { query: Record<string, string> }) => void) | null = null
    const broker: ClientAuthBrokerClient = {
      ...unusedBrokerMethods,
      exchangeFeishuCode: async () => ({
        user: { provider: 'feishu', userId: 'ou_user' },
        modelAccessToken: 'model-access-token',
      }),
    }
    const service = createClientAuthService({
      required: true,
      feishuBrokerAuth: {
        appId: 'cli_test',
        brokerUrl: 'https://auth.storyflow.example.com',
      },
    }, {
      createAuthBrokerClient: () => broker,
      createCallbackServer: async () => ({
        url: 'http://localhost:6477',
        promise: new Promise((resolve) => {
          resolveCallback = resolve
        }),
        close: () => {},
      }),
      openExternal: async (url) => {
        callbackState = new URL(url).searchParams.get('state') ?? ''
        resolveCallback?.({
          query: {
            code: 'feishu-code',
            state: callbackState,
          },
        })
      },
    })

    await expect(service.signInWithFeishu())
      .rejects
      .toThrow('app session token')
    expect(service.getState().authenticated).toBe(false)
  })

  it('times out Feishu sign-in when the browser never returns to the callback URL', async () => {
    let closeCalled = false
    const broker: ClientAuthBrokerClient = {
      ...unusedBrokerMethods,
    }
    const service = createClientAuthService({
      required: true,
      feishuCallbackPort: 6477,
      feishuLoginTimeoutMs: 5,
      feishuBrokerAuth: {
        appId: 'cli_test',
        brokerUrl: 'https://auth.storyflow.example.com',
      },
    }, {
      createAuthBrokerClient: () => broker,
      createCallbackServer: async () => ({
        url: 'http://localhost:6477',
        promise: new Promise(() => {}),
        close: () => {
          closeCalled = true
        },
      }),
      openExternal: async () => {},
    })

    await expect(service.signInWithFeishu())
      .rejects
      .toThrow('Feishu login timed out')
    expect(closeCalled).toBe(true)
    expect(service.getState().authenticated).toBe(false)
  })

  it('cancels a pending Feishu sign-in attempt', async () => {
    let closeCalled = false
    let markBrowserOpened: (() => void) | null = null
    const browserOpened = new Promise<void>((resolve) => {
      markBrowserOpened = resolve
    })
    const broker: ClientAuthBrokerClient = {
      ...unusedBrokerMethods,
    }
    const service = createClientAuthService({
      required: true,
      feishuCallbackPort: 6477,
      feishuLoginTimeoutMs: 60_000,
      feishuBrokerAuth: {
        appId: 'cli_test',
        brokerUrl: 'https://auth.storyflow.example.com',
      },
    }, {
      createAuthBrokerClient: () => broker,
      createCallbackServer: async () => ({
        url: 'http://localhost:6477',
        promise: new Promise(() => {}),
        close: () => {
          closeCalled = true
        },
      }),
      openExternal: async () => {
        markBrowserOpened?.()
      },
    })

    const pending = service.signInWithFeishu()
    await browserOpened

    service.cancelFeishuSignIn()

    await expect(pending)
      .rejects
      .toThrow('Feishu login was cancelled')
    expect(closeCalled).toBe(true)
    expect(service.getState().authenticated).toBe(false)
  })

})
