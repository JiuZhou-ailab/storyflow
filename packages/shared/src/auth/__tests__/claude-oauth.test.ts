import { afterEach, describe, expect, it } from 'bun:test'
import {
  registerOAuthProvider,
  unregisterOAuthProvider,
  type OAuthLoginCallbacks,
} from '@earendil-works/pi-ai/oauth'
import {
  clearOAuthState,
  exchangeClaudeCode,
  hasValidOAuthState,
  prepareClaudeOAuth,
} from '../claude-oauth.ts'

afterEach(() => {
  clearOAuthState()
  unregisterOAuthProvider('anthropic')
})

describe('Claude OAuth Pi bridge', () => {
  it('keeps the two-step product flow while Pi owns login and credentials', async () => {
    let submittedCode = ''
    registerOAuthProvider({
      id: 'anthropic',
      name: 'Fake Anthropic',
      async login(callbacks: OAuthLoginCallbacks) {
        callbacks.onAuth({ url: 'https://example.test/authorize' })
        submittedCode = await callbacks.onManualCodeInput!()
        return {
          access: 'pi-access',
          refresh: 'pi-refresh',
          expires: 123456,
        }
      },
      async refreshToken(credentials) {
        return credentials
      },
      getApiKey(credentials) {
        return credentials.access
      },
    })

    const prepared = await prepareClaudeOAuth()
    expect(prepared.authUrl).toBe('https://example.test/authorize')
    expect(prepared.wasCodeSubmitted()).toBe(false)
    expect(hasValidOAuthState()).toBe(true)

    expect(await exchangeClaudeCode('copied-code')).toEqual({
      accessToken: 'pi-access',
      refreshToken: 'pi-refresh',
      expiresAt: 123456,
    })
    expect(submittedCode).toBe('copied-code')
    expect(prepared.wasCodeSubmitted()).toBe(true)
    expect(hasValidOAuthState()).toBe(false)
  })

  it('exposes automatic Pi callback completion without manual code submission', async () => {
    registerOAuthProvider({
      id: 'anthropic',
      name: 'Fake Anthropic',
      async login(callbacks: OAuthLoginCallbacks) {
        callbacks.onAuth({ url: 'https://example.test/authorize' })
        return {
          access: 'callback-access',
          refresh: 'callback-refresh',
          expires: 654321,
        }
      },
      async refreshToken(credentials) {
        return credentials
      },
      getApiKey(credentials) {
        return credentials.access
      },
    })

    const prepared = await prepareClaudeOAuth()

    expect(await prepared.completion).toEqual({
      accessToken: 'callback-access',
      refreshToken: 'callback-refresh',
      expiresAt: 654321,
    })
    expect(prepared.wasCodeSubmitted()).toBe(false)
    expect(hasValidOAuthState()).toBe(false)
  })

  it('cancels the pending Pi login', async () => {
    registerOAuthProvider({
      id: 'anthropic',
      name: 'Fake Anthropic',
      async login(callbacks: OAuthLoginCallbacks) {
        callbacks.onAuth({ url: 'https://example.test/authorize' })
        await callbacks.onManualCodeInput!()
        throw new Error('unreachable')
      },
      async refreshToken(credentials) {
        return credentials
      },
      getApiKey(credentials) {
        return credentials.access
      },
    })

    const prepared = await prepareClaudeOAuth()
    clearOAuthState()

    expect(prepared.wasCancelled()).toBe(true)
    expect(hasValidOAuthState()).toBe(false)
    expect(exchangeClaudeCode('late-code')).rejects.toThrow('OAuth session expired')
  })

  it('rejects an empty manual code without consuming the pending flow', async () => {
    registerOAuthProvider({
      id: 'anthropic',
      name: 'Fake Anthropic',
      async login(callbacks: OAuthLoginCallbacks) {
        callbacks.onAuth({ url: 'https://example.test/authorize' })
        await callbacks.onManualCodeInput!()
        return { access: 'unused', refresh: 'unused', expires: 1 }
      },
      async refreshToken(credentials) { return credentials },
      getApiKey(credentials) { return credentials.access },
    })

    await prepareClaudeOAuth()
    expect(exchangeClaudeCode('   ')).rejects.toThrow('Authorization code is required')
    expect(hasValidOAuthState()).toBe(true)
  })
})
