import { describe, expect, it } from 'bun:test'
import {
  buildFeishuAuthorizeUrl,
  DefaultFeishuOAuthClient,
  decideFeishuLoginAccess,
  FeishuOAuthStateStore,
  type FeishuRegistrationStore,
  type FeishuUserInfo,
} from './feishu-auth'

const INTERNAL_USER: FeishuUserInfo = {
  openId: 'ou_internal',
  tenantKey: 'tenant_internal',
  email: 'internal@example.com',
}

const EXTERNAL_USER: FeishuUserInfo = {
  openId: 'ou_external',
  tenantKey: 'tenant_external',
  email: 'external@example.com',
}

function createStore(registered: boolean): FeishuRegistrationStore {
  return {
    isRegistered: async () => registered,
  }
}

describe('buildFeishuAuthorizeUrl', () => {
  it('builds a PKCE Feishu authorization URL', () => {
    const authUrl = buildFeishuAuthorizeUrl({
      appId: 'cli_xxx',
      redirectUri: 'https://craft.example.com/api/auth/feishu/callback',
      state: 'state_123',
      codeChallenge: 'challenge_123',
      scope: 'openid profile email',
    })

    const url = new URL(authUrl)
    expect(url.origin + url.pathname).toBe('https://accounts.feishu.cn/open-apis/authen/v1/authorize')
    expect(url.searchParams.get('client_id')).toBe('cli_xxx')
    expect(url.searchParams.get('redirect_uri')).toBe('https://craft.example.com/api/auth/feishu/callback')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('state_123')
    expect(url.searchParams.get('code_challenge')).toBe('challenge_123')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toBe('openid profile email')
  })

  it('omits scope unless explicitly configured', () => {
    const authUrl = buildFeishuAuthorizeUrl({
      appId: 'cli_xxx',
      redirectUri: 'https://craft.example.com/api/auth/feishu/callback',
      state: 'state_123',
      codeChallenge: 'challenge_123',
    })

    expect(new URL(authUrl).searchParams.has('scope')).toBe(false)
  })
})

describe('FeishuOAuthStateStore', () => {
  it('consumes a state only once', () => {
    const store = new FeishuOAuthStateStore()
    const state = store.create('https://craft.example.com/api/auth/feishu/callback')

    expect(store.consume(state.state)?.codeVerifier).toBe(state.codeVerifier)
    expect(store.consume(state.state)).toBeNull()
  })
})

describe('DefaultFeishuOAuthClient', () => {
  it('reads token and user info from Feishu response envelopes', async () => {
    const client = new DefaultFeishuOAuthClient({
      appId: 'cli_xxx',
      appSecret: 'secret_xxx',
      fetch: async (url) => {
        if (String(url).endsWith('/open-apis/authen/v2/oauth/token')) {
          return Response.json({ data: { user_access_token: 'user_token' } })
        }

        return Response.json({
          data: {
            open_id: 'ou_user',
            tenant_key: 'tenant_internal',
            enterprise_email: 'USER@example.com',
          },
        })
      },
    })

    const token = await client.exchangeCode({
      code: 'auth_code',
      redirectUri: 'https://craft.example.com/api/auth/feishu/callback',
      codeVerifier: 'verifier',
    })
    const user = await client.getUserInfo(token.accessToken)

    expect(token).toEqual({ accessToken: 'user_token' })
    expect(user).toEqual({
      openId: 'ou_user',
      unionId: undefined,
      userId: undefined,
      tenantKey: 'tenant_internal',
      email: undefined,
      enterpriseEmail: 'USER@example.com',
      name: undefined,
      avatarUrl: undefined,
    })
  })
})

describe('decideFeishuLoginAccess', () => {
  it('allows company-internal Feishu tenants without registration', async () => {
    let checkedRegistration = false
    const store: FeishuRegistrationStore = {
      isRegistered: async () => {
        checkedRegistration = true
        return false
      },
    }

    const decision = await decideFeishuLoginAccess({
      user: INTERNAL_USER,
      internalTenantKeys: ['tenant_internal'],
      registrationStore: store,
    })

    expect(decision).toEqual({ allowed: true, reason: 'internal', user: INTERNAL_USER })
    expect(checkedRegistration).toBe(false)
  })

  it('allows external Feishu users that have an active registration', async () => {
    const decision = await decideFeishuLoginAccess({
      user: EXTERNAL_USER,
      internalTenantKeys: ['tenant_internal'],
      registrationStore: createStore(true),
    })

    expect(decision).toEqual({ allowed: true, reason: 'registered', user: EXTERNAL_USER })
  })

  it('allows any Feishu user when the open Feishu account policy is enabled', async () => {
    const decision = await decideFeishuLoginAccess({
      user: EXTERNAL_USER,
      internalTenantKeys: [],
      allowAllUsers: true,
      registrationStore: createStore(false),
    })

    expect(decision).toEqual({ allowed: true, reason: 'feishu-account', user: EXTERNAL_USER })
  })

  it('blocks unregistered external Feishu users', async () => {
    const decision = await decideFeishuLoginAccess({
      user: EXTERNAL_USER,
      internalTenantKeys: ['tenant_internal'],
      registrationStore: createStore(false),
    })

    expect(decision).toEqual({ allowed: false, reason: 'registration-required', user: EXTERNAL_USER })
  })
})
