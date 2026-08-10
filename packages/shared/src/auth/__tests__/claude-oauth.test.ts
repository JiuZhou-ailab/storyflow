// input: Fake Pi provider-owned OAuth login interactions and product RPC calls
// output: Regression coverage for manual, callback, cancellation, and validation flows
// pos: Contract test for the Claude OAuth bridge

import { afterEach, describe, expect, it } from 'bun:test'
import type { AuthInteraction, Credential, Models } from '@earendil-works/pi-ai'
import {
  clearOAuthState,
  exchangeClaudeCode,
  hasValidOAuthState,
  prepareClaudeOAuth,
} from '../claude-oauth.ts'

afterEach(() => {
  clearOAuthState()
})

function fakeModels(
  login: (interaction: AuthInteraction) => Promise<Credential>,
): Pick<Models, 'login'> {
  return {
    async login(providerId, type, interaction) {
      expect(providerId).toBe('anthropic')
      expect(type).toBe('oauth')
      return login(interaction)
    },
  }
}

describe('Claude OAuth Pi bridge', () => {
  it('keeps the two-step product flow while Pi owns login and credentials', async () => {
    let submittedCode = ''
    const models = fakeModels(async interaction => {
      interaction.notify({ type: 'auth_url', url: 'https://example.test/authorize' })
      submittedCode = await interaction.prompt({ type: 'manual_code', message: 'Code' })
      return {
        type: 'oauth',
        access: 'pi-access',
        refresh: 'pi-refresh',
        expires: 123456,
      }
    })

    const prepared = await prepareClaudeOAuth(models)
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
    const models = fakeModels(async interaction => {
      interaction.notify({ type: 'auth_url', url: 'https://example.test/authorize' })
      return {
        type: 'oauth',
        access: 'callback-access',
        refresh: 'callback-refresh',
        expires: 654321,
      }
    })

    const prepared = await prepareClaudeOAuth(models)

    expect(await prepared.completion).toEqual({
      accessToken: 'callback-access',
      refreshToken: 'callback-refresh',
      expiresAt: 654321,
    })
    expect(prepared.wasCodeSubmitted()).toBe(false)
    expect(hasValidOAuthState()).toBe(false)
  })

  it('cancels the pending Pi login', async () => {
    const models = fakeModels(async interaction => {
      interaction.notify({ type: 'auth_url', url: 'https://example.test/authorize' })
      await interaction.prompt({ type: 'manual_code', message: 'Code' })
      throw new Error('unreachable')
    })

    const prepared = await prepareClaudeOAuth(models)
    clearOAuthState()

    expect(prepared.wasCancelled()).toBe(true)
    expect(hasValidOAuthState()).toBe(false)
    expect(exchangeClaudeCode('late-code')).rejects.toThrow('OAuth session expired')
  })

  it('rejects an empty manual code without consuming the pending flow', async () => {
    const models = fakeModels(async interaction => {
      interaction.notify({ type: 'auth_url', url: 'https://example.test/authorize' })
      await interaction.prompt({ type: 'manual_code', message: 'Code' })
      return { type: 'oauth', access: 'unused', refresh: 'unused', expires: 1 }
    })

    await prepareClaudeOAuth(models)
    expect(exchangeClaudeCode('   ')).rejects.toThrow('Authorization code is required')
    expect(hasValidOAuthState()).toBe(true)
  })
})
