// input: Desktop broker configuration, HTTP responses, and bounded request behavior
// output: Secure broker transport and capability-response regression coverage
// pos: Tests the main-process auth broker trust boundary independently of login UI flows

import { afterEach, describe, expect, it } from 'bun:test'
import {
  createClientAuthConfigFromEnv,
  createClientAuthService,
  DefaultClientAuthBrokerClient,
} from '../client-auth'

const originalFetch = globalThis.fetch

function accessToken(exp: number): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
    Buffer.from(JSON.stringify({ exp })).toString('base64url'),
    'signature',
  ].join('.')
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('client auth broker config', () => {
  it('does not configure distributed Feishu auth from app secrets', () => {
    const config = createClientAuthConfigFromEnv({
      CRAFT_CLIENT_AUTH_REQUIRED: 'true',
      CRAFT_WEBUI_FEISHU_APP_ID: 'cli_test',
      CRAFT_CLIENT_FEISHU_APP_SECRET: 'secret_test',
      CRAFT_WEBUI_FEISHU_APP_SECRET: 'server-only-secret',
      CRAFT_WEBUI_FEISHU_INTERNAL_TENANT_KEYS: 'tenant_a, tenant_b',
    })

    expect(config.feishuBrokerAuth).toBeUndefined()
    expect((config as unknown as Record<string, unknown>).feishuAuth).toBeUndefined()
    expect(JSON.stringify(config)).not.toContain('secret_test')
    expect(JSON.stringify(config)).not.toContain('server-only-secret')
  })

  it('requires an explicit desktop Feishu app id', () => {
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

  it('keeps Feishu secrets and access policy on the HTTPS broker', () => {
    const config = createClientAuthConfigFromEnv({
      CRAFT_CLIENT_AUTH_REQUIRED: 'true',
      CRAFT_CLIENT_AUTH_BROKER_URL: ' https://auth.storyflow.example.com/ ',
      CRAFT_CLIENT_FEISHU_APP_ID: 'cli_test',
      CRAFT_WEBUI_FEISHU_APP_SECRET: 'server-only-secret',
      CRAFT_CLIENT_FEISHU_INTERNAL_TENANT_KEYS: 'tenant_internal',
    })

    expect(config.feishuBrokerAuth).toEqual({
      appId: 'cli_test',
      brokerUrl: 'https://auth.storyflow.example.com',
    })
    expect(JSON.stringify(config)).not.toContain('server-only-secret')
    expect(JSON.stringify(config)).not.toContain('tenant_internal')
  })

  it('rejects remote plaintext broker URLs but allows loopback development', () => {
    expect(() => createClientAuthConfigFromEnv({
      CRAFT_CLIENT_AUTH_BROKER_URL: 'http://auth.storyflow.example.com',
    })).toThrow('must use HTTPS')

    expect(createClientAuthConfigFromEnv({
      CRAFT_CLIENT_AUTH_BROKER_URL: 'http://127.0.0.1:8787/',
    }).authBrokerUrl).toBe('http://127.0.0.1:8787')
  })
})

describe('DefaultClientAuthBrokerClient', () => {

  it('preserves the Feishu profile and company scope from the broker', async () => {
    globalThis.fetch = (async () => Response.json({
      user: {
        provider: 'feishu',
        userId: 'ou_user',
        organizationId: 'storyflow',
        name: 'User',
        avatarUrl: 'https://example.com/user.png',
      },
      appSessionToken: 'app-session-token',
      modelAccessToken: 'model-access-token',
    })) as unknown as typeof fetch

    const result = await new DefaultClientAuthBrokerClient().exchangeFeishuCode({
      brokerUrl: 'https://auth.storyflow.example.com',
      code: 'feishu-code',
      redirectUri: 'http://localhost:6477/callback',
      codeVerifier: 'code-verifier',
    })

    expect(result.user.avatarUrl).toBe('https://example.com/user.png')
    expect(result.user.organizationId).toBe('storyflow')
  })

  it('does not accept the retired sessionToken response alias', async () => {
    globalThis.fetch = (async () => Response.json({
      user: { provider: 'neon', userId: 'user-1' },
      sessionToken: 'retired-session-token',
      modelAccessToken: 'model-access-token',
    })) as unknown as typeof fetch

    const result = await new DefaultClientAuthBrokerClient().exchangeNeonToken({
      brokerUrl: 'https://auth.storyflow.example.com',
      token: 'provider-token',
    })

    expect(result.appSessionToken).toBeUndefined()
    expect(result.modelAccessToken).toBe('model-access-token')
  })

  it('refreshes capabilities from the Storyflow identity session alone', async () => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      expect(input.toString()).toBe('https://auth.storyflow.example.com/api/client-auth/token')
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer app-session-token')
      expect(init?.body).toBeUndefined()
      return Response.json({
        appSessionToken: 'app-session-token',
        modelAccessToken: 'model-access-token',
      })
    }) as unknown as typeof fetch

    await new DefaultClientAuthBrokerClient().refreshModelAccessToken({
      brokerUrl: 'https://auth.storyflow.example.com',
      appSessionToken: 'app-session-token',
    })
  })

  it('bounds half-open broker requests', async () => {
    globalThis.fetch = ((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    })) as typeof fetch

    const client = new DefaultClientAuthBrokerClient(5)
    await expect(client.refreshModelAccessToken({
      brokerUrl: 'https://auth.storyflow.example.com',
      appSessionToken: 'app-session-token',
    })).rejects.toThrow('Auth broker is unreachable')
  })

  it('requests a short-lived Skills Market capability with the app session', async () => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      expect(input.toString()).toBe('https://auth.storyflow.example.com/api/client-auth/skills-market/token')
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer app-session-token')
      return Response.json({
        ok: true,
        marketPublishToken: 'market-publish-token',
        expiresInSeconds: 300,
      })
    }) as unknown as typeof fetch

    const result = await new DefaultClientAuthBrokerClient().issueSkillsMarketToken({
      brokerUrl: 'https://auth.storyflow.example.com',
      appSessionToken: 'app-session-token',
    })

    expect(result).toEqual({ marketPublishToken: 'market-publish-token', expiresInSeconds: 300 })
  })

  it('keeps managed tool capabilities process-local and refreshable', async () => {
    const token = accessToken(Math.floor(Date.now() / 1000) + 24 * 60 * 60)
    let requests = 0
    let saves = 0
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests += 1
      expect(input.toString()).toBe('https://auth.storyflow.example.com/api/client-auth/tools/token')
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer app-session-token')
      return Response.json({ ok: true, toolAccessToken: token })
    }) as unknown as typeof fetch

    const service = createClientAuthService({
      required: true,
      authBrokerUrl: 'https://auth.storyflow.example.com',
    }, {
      initialSession: {
        user: { provider: 'neon', userId: 'user-1' },
        appSessionToken: 'app-session-token',
      },
      sessionStore: {
        save: async () => { saves += 1 },
        clear: async () => {},
      },
    })

    await expect(service.ensureToolAccessToken()).resolves.toEqual({ token, refreshed: true })
    await expect(service.ensureToolAccessToken()).resolves.toEqual({ token, refreshed: false })
    await expect(service.ensureToolAccessToken({ force: true })).resolves.toEqual({ token, refreshed: true })
    expect(requests).toBe(2)
    expect(saves).toBe(0)
  })

  it('clears only broker-rejected app sessions during refresh', async () => {
    const makeService = (clear: () => void) => createClientAuthService({
      required: true,
      authBrokerUrl: 'https://auth.storyflow.example.com',
    }, {
      initialSession: {
        user: { provider: 'feishu', userId: 'user-1' },
        appSessionToken: 'private-app-session',
      },
      sessionStore: { save: async () => {}, clear: async () => { clear() } },
    })

    globalThis.fetch = (async () => Response.json(
      { error: 'invalid session' },
      { status: 401 },
    )) as unknown as typeof fetch
    let invalidClearCount = 0
    const invalidService = makeService(() => { invalidClearCount += 1 })
    await expect(invalidService.ensureModelAccessToken()).rejects.toThrow()
    expect(invalidClearCount).toBe(1)
    expect(invalidService.getState().authenticated).toBe(false)

    globalThis.fetch = (async () => Response.json(
      { error: 'temporary failure' },
      { status: 503 },
    )) as unknown as typeof fetch
    let temporaryClearCount = 0
    const temporaryService = makeService(() => { temporaryClearCount += 1 })
    await expect(temporaryService.ensureModelAccessToken()).rejects.toThrow()
    expect(temporaryClearCount).toBe(0)
    expect(temporaryService.getState().authenticated).toBe(true)
  })
})
