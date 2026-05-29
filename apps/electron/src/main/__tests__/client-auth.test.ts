import { describe, expect, it } from 'bun:test'
import {
  createClientAuthConfigFromEnv,
  createClientAuthConfigFromRuntimeEnv,
  createClientAuthService,
  DefaultClientAuthBrokerClient,
  type ClientAuthBrokerClient,
  type ClientAuthNeonService,
} from '../client-auth'

describe('client auth', () => {
  it('treats disabled client auth as already authenticated', () => {
    const service = createClientAuthService({ required: false })

    expect(service.getState()).toEqual({
      required: false,
      configured: false,
      authenticated: true,
      emailPasswordEnabled: false,
      feishuLoginEnabled: false,
    })
  })

  it('requires client auth by default in packaged runtime', () => {
    const config = createClientAuthConfigFromEnv({
      CRAFT_IS_PACKAGED: '1',
    })
    const service = createClientAuthService(config)

    expect(service.getState()).toEqual({
      required: true,
      configured: false,
      authenticated: false,
      emailPasswordEnabled: false,
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
      authenticated: true,
      emailPasswordEnabled: false,
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
      feishuLoginEnabled: false,
    })
    await expect(service.signIn({ identifier: 'zjding', password: 'secret' }))
      .rejects
      .toThrow('Client auth is not configured')
  })

  it('stores the verified Neon Auth identity after password sign-in', async () => {
    const calls: Array<{ email: string, password: string, origin?: string }> = []
    const fakeNeonAuth: ClientAuthNeonService = {
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
      neonAuth: {
        baseUrl: 'https://auth.example.com',
        usernameEmailDomain: 'users.craft.invalid',
      },
    }, {
      createNeonAuthService: () => fakeNeonAuth,
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
      feishuLoginEnabled: false,
      usernameLoginEnabled: true,
      user: signedIn,
    })
  })

  it('registers a Neon Auth email account and signs in when the provider returns a token', async () => {
    const calls: Array<{ mode: string, email: string, password: string, name?: string, origin?: string }> = []
    const fakeNeonAuth: ClientAuthNeonService = {
      isConfigured: () => true,
      getClientConfig: () => ({ enabled: true }),
      authenticateWithEmailPassword: async (input) => {
        calls.push({
          mode: input.mode,
          email: input.email,
          password: input.password,
          name: input.name,
          origin: input.origin,
        })
        return { status: 'authenticated', token: 'signup-jwt-token' }
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
      neonAuth: { baseUrl: 'https://auth.example.com' },
    }, {
      createNeonAuthService: () => fakeNeonAuth,
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
  })

  it('keeps the client unauthenticated when Neon Auth registration requires email verification', async () => {
    const fakeNeonAuth: ClientAuthNeonService = {
      isConfigured: () => true,
      getClientConfig: () => ({ enabled: true }),
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
      { required: true, neonAuth: { baseUrl: 'https://auth.example.com' } },
      { createNeonAuthService: () => fakeNeonAuth },
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

  it('keeps Neon login separate from auth broker model credential exchange', async () => {
    const exchangedTokens: string[] = []
    const fakeNeonAuth: ClientAuthNeonService = {
      isConfigured: () => true,
      getClientConfig: () => ({ enabled: true }),
      authenticateWithEmailPassword: async () => ({ status: 'authenticated', token: 'neon-jwt-token' }),
      verifyToken: async () => ({
        provider: 'neon',
        userId: 'user-1',
        subject: 'neon:user-1',
        email: 'user@example.com',
      }),
    }
    const broker: ClientAuthBrokerClient = {
      exchangeNeonToken: async (input) => {
        exchangedTokens.push(input.token)
        expect(input.brokerUrl).toBe('https://auth.storyflow.example.com')
        return {
          user: {
            provider: 'neon',
            userId: 'user-1',
            email: 'user@example.com',
          },
          appSessionToken: 'app-session-token',
        }
      },
      exchangeFeishuCode: async () => {
        throw new Error('not used')
      },
    }

    const service = createClientAuthService({
      required: true,
      neonAuth: { baseUrl: 'https://auth.example.com' },
      authBrokerUrl: 'https://auth.storyflow.example.com',
    }, {
      createNeonAuthService: () => fakeNeonAuth,
      createAuthBrokerClient: () => broker,
    })

    await service.signIn({ identifier: 'user@example.com', password: 'secret' })

    expect(exchangedTokens).toEqual([])
  })

  it('clears the process-local identity on sign-out', async () => {
    const fakeNeonAuth: ClientAuthNeonService = {
      isConfigured: () => true,
      getClientConfig: () => ({ enabled: true }),
      authenticateWithEmailPassword: async () => ({ status: 'authenticated', token: 'jwt-token' }),
      verifyToken: async () => ({
        provider: 'neon',
        userId: 'user-1',
        subject: 'neon:user-1',
      }),
    }
    const service = createClientAuthService(
      { required: true, neonAuth: { baseUrl: 'https://auth.example.com' } },
      { createNeonAuthService: () => fakeNeonAuth },
    )

    await service.signIn({ identifier: 'user@example.com', password: 'secret' })
    await service.signOut()

    expect(service.getState()).toEqual({
      required: true,
      configured: true,
      authenticated: false,
      emailPasswordEnabled: true,
      feishuLoginEnabled: false,
    })
  })

  it('reads Electron client auth config from client env with WebUI Neon fallback and a stable Origin', () => {
    const config = createClientAuthConfigFromEnv({
      CRAFT_CLIENT_AUTH_REQUIRED: 'true',
      CRAFT_WEBUI_NEON_AUTH_BASE_URL: 'https://auth.example.com',
      CRAFT_WEBUI_NEON_AUTH_USERNAME_EMAIL_DOMAIN: 'users.craft.invalid',
    })

    expect(config).toEqual({
      required: true,
      neonAuthOrigin: 'http://localhost:9100',
      neonAuth: {
        baseUrl: 'https://auth.example.com',
        usernameEmailDomain: 'users.craft.invalid',
      },
    })
  })

  it('allows overriding the Neon Auth Origin for Electron client sign-in', () => {
    const config = createClientAuthConfigFromEnv({
      CRAFT_CLIENT_AUTH_REQUIRED: 'true',
      CRAFT_CLIENT_NEON_AUTH_BASE_URL: 'https://auth.example.com',
      CRAFT_CLIENT_NEON_AUTH_ORIGIN: 'http://127.0.0.1:3100',
    })

    expect(config.neonAuthOrigin).toBe('http://127.0.0.1:3100')
  })

  it('does not configure distributed Feishu client auth from app secrets', () => {
    const config = createClientAuthConfigFromEnv({
      CRAFT_CLIENT_AUTH_REQUIRED: 'true',
      CRAFT_WEBUI_FEISHU_APP_ID: 'cli_test',
      CRAFT_CLIENT_FEISHU_APP_SECRET: 'secret_test',
      CRAFT_WEBUI_FEISHU_APP_SECRET: 'server-only-secret',
      CRAFT_WEBUI_FEISHU_INTERNAL_TENANT_KEYS: 'tenant_a, tenant_b',
      CRAFT_CLIENT_FEISHU_CALLBACK_PORT: '6477',
    })

    expect(config.feishuBrokerAuth).toBeUndefined()
    expect((config as unknown as Record<string, unknown>).feishuAuth).toBeUndefined()
    expect(JSON.stringify(config)).not.toContain('secret_test')
    expect(JSON.stringify(config)).not.toContain('server-only-secret')
  })

  it('requires an explicit desktop Feishu app id instead of falling back to WebUI app id', () => {
    const config = createClientAuthConfigFromEnv({
      CRAFT_CLIENT_AUTH_REQUIRED: 'true',
      CRAFT_CLIENT_AUTH_BROKER_URL: 'https://auth.storyflow.example.com',
      CRAFT_WEBUI_FEISHU_APP_ID: 'cli_webui_only',
      CRAFT_WEBUI_FEISHU_APP_SECRET: 'server-only-secret',
    })

    expect(config.feishuBrokerAuth).toBeUndefined()
    expect(JSON.stringify(config)).not.toContain('cli_webui_only')
    expect(JSON.stringify(config)).not.toContain('server-only-secret')
  })

  it('configures Feishu client auth through a broker without requiring a client secret', () => {
    const config = createClientAuthConfigFromEnv({
      CRAFT_CLIENT_AUTH_REQUIRED: 'true',
      CRAFT_CLIENT_AUTH_BROKER_URL: ' https://auth.storyflow.example.com/ ',
      CRAFT_CLIENT_FEISHU_APP_ID: 'cli_test',
      CRAFT_CLIENT_FEISHU_CALLBACK_PORT: '6477',
      CRAFT_WEBUI_FEISHU_APP_SECRET: 'server-only-secret',
    })

    expect(config.feishuBrokerAuth).toEqual({
      appId: 'cli_test',
      brokerUrl: 'https://auth.storyflow.example.com',
    })
    expect((config as unknown as Record<string, unknown>).feishuAuth).toBeUndefined()
    expect(JSON.stringify(config)).not.toContain('server-only-secret')
  })

  it('keeps Feishu access policy on the broker instead of the distributed client', () => {
    const config = createClientAuthConfigFromEnv({
      CRAFT_CLIENT_AUTH_REQUIRED: 'true',
      CRAFT_CLIENT_FEISHU_APP_ID: 'cli_test',
      CRAFT_CLIENT_AUTH_BROKER_URL: 'https://auth.storyflow.example.com',
      CRAFT_CLIENT_FEISHU_ALLOW_ALL_USERS: 'false',
      CRAFT_CLIENT_FEISHU_INTERNAL_TENANT_KEYS: 'tenant_internal',
    })

    expect(config.feishuBrokerAuth).toEqual({
      appId: 'cli_test',
      brokerUrl: 'https://auth.storyflow.example.com',
    })
    expect(JSON.stringify(config)).not.toContain('tenant_internal')
    expect(JSON.stringify(config)).not.toContain('allowAllUsers')
  })

  it('reads the Feishu login timeout from client env', () => {
    const config = createClientAuthConfigFromEnv({
      CRAFT_CLIENT_AUTH_REQUIRED: 'true',
      CRAFT_CLIENT_FEISHU_APP_ID: 'cli_test',
      CRAFT_CLIENT_AUTH_BROKER_URL: 'https://auth.storyflow.example.com',
      CRAFT_CLIENT_FEISHU_LOGIN_TIMEOUT_MS: '5000',
    })

    expect(config.feishuLoginTimeoutMs).toBe(5000)
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
      exchangeNeonToken: async () => {
        throw new Error('not used')
      },
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
      feishuLoginEnabled: true,
      user: signedIn,
    })
  })

  it('uses the broker Feishu app id instead of the packaged fallback app id', async () => {
    const openedUrls: string[] = []
    let callbackState = ''
    let resolveCallback: ((value: { query: Record<string, string> }) => void) | null = null
    const broker = {
      getFeishuAuthConfig: async () => ({
        enabled: true,
        appId: 'cli_user_deployment',
      }),
      exchangeNeonToken: async () => {
        throw new Error('not used')
      },
      exchangeFeishuCode: async () => ({
        user: {
          provider: 'feishu' as const,
          userId: 'ou_user',
        },
        appSessionToken: 'app-session-token',
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

  it('keeps sign-out separate from managed model credentials', async () => {
    const fakeNeonAuth: ClientAuthNeonService = {
      isConfigured: () => true,
      getClientConfig: () => ({ enabled: true }),
      authenticateWithEmailPassword: async () => ({ status: 'authenticated', token: 'jwt-token' }),
      verifyToken: async () => ({
        provider: 'neon',
        userId: 'user-1',
        subject: 'neon:user-1',
      }),
    }
    const service = createClientAuthService({
      required: true,
      neonAuth: { baseUrl: 'https://auth.example.com' },
    }, {
      createNeonAuthService: () => fakeNeonAuth,
    })

    await service.signIn({ identifier: 'user@example.com', password: 'secret' })
    await service.signOut()

    expect(service.getState().authenticated).toBe(false)
  })

  it('rejects Feishu sign-in when the Feishu account requires registration', async () => {
    let callbackState = ''
    let resolveCallback: ((value: { query: Record<string, string> }) => void) | null = null
    const broker: ClientAuthBrokerClient = {
      exchangeNeonToken: async () => {
        throw new Error('not used')
      },
      exchangeFeishuCode: async () => {
        throw new Error('Feishu registration is required')
      },
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
      .toThrow('Feishu registration is required')
    expect(service.getState().authenticated).toBe(false)
  })

  it('times out Feishu sign-in when the browser never returns to the callback URL', async () => {
    let closeCalled = false
    const broker: ClientAuthBrokerClient = {
      exchangeNeonToken: async () => {
        throw new Error('not used')
      },
      exchangeFeishuCode: async () => {
        throw new Error('not used')
      },
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
      exchangeNeonToken: async () => {
        throw new Error('not used')
      },
      exchangeFeishuCode: async () => {
        throw new Error('not used')
      },
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

  it('explains when the Feishu auth broker cannot be reached', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch

    try {
      const broker = new DefaultClientAuthBrokerClient()
      await expect(broker.exchangeFeishuCode({
        brokerUrl: 'http://localhost:9100',
        code: 'feishu-code',
        redirectUri: 'http://localhost:6477/callback',
        codeVerifier: 'verifier',
      }))
        .rejects
        .toThrow('Auth broker is unreachable at http://localhost:9100/api/client-auth/feishu/exchange')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
