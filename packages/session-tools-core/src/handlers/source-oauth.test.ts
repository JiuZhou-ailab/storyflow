// input: OAuth Session Tool calls after the Host revokes a Project Source grant
// output: Regression coverage that denied Sources cannot read credentials or start OAuth
// pos: Guards Host Source grants at every OAuth handler side-effect boundary

import { describe, expect, it } from 'bun:test'
import type { SessionToolContext } from '../context.ts'
import {
  handleGoogleOAuthTrigger,
  handleMicrosoftOAuthTrigger,
  handleSlackOAuthTrigger,
  handleSourceOAuthTrigger,
} from './source-oauth.ts'
import { handleCredentialPrompt } from './credential-prompt.ts'

describe('Source OAuth Host grants', () => {
  it('blocks every OAuth handler before credential or browser side effects', async () => {
    const cases = [
      {
        handler: handleSourceOAuthTrigger,
        source: {
          slug: 'foo', name: 'Foo', type: 'mcp', isAuthenticated: true,
          mcp: { authType: 'oauth' },
        },
      },
      {
        handler: handleGoogleOAuthTrigger,
        source: {
          slug: 'foo', name: 'Foo', type: 'api', provider: 'google', isAuthenticated: true,
          api: { authType: 'oauth', googleService: 'gmail' },
        },
      },
      {
        handler: handleSlackOAuthTrigger,
        source: {
          slug: 'foo', name: 'Foo', type: 'api', provider: 'slack', isAuthenticated: true,
          api: { authType: 'oauth', slackService: 'full' },
        },
      },
      {
        handler: handleMicrosoftOAuthTrigger,
        source: {
          slug: 'foo', name: 'Foo', type: 'api', provider: 'microsoft', isAuthenticated: true,
          api: { authType: 'oauth', microsoftService: 'outlook' },
        },
      },
    ] as const

    for (const { handler, source } of cases) {
      const sideEffects: string[] = []
      const ctx = {
        sessionId: 'session-1',
        workspacePath: '/tmp/project',
        loadSourceConfig: () => source,
        isSourceExecutionAllowed: () => false,
        isGoogleOAuthConfigured: () => true,
        credentialManager: {
          hasValidCredentials: async () => false,
          getToken: async () => { sideEffects.push('getToken'); return 'token' },
          refresh: async () => { sideEffects.push('refresh'); return 'token' },
        },
        callbacks: {
          onAuthRequest: () => { sideEffects.push('auth') },
        },
      } as unknown as SessionToolContext

      const result = await handler(ctx, { sourceSlug: 'foo' })

      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toContain('not enabled by Host settings')
      expect(sideEffects).toEqual([])
    }
  })

  it('blocks credential prompts before showing auth UI', async () => {
    let prompted = false
    const ctx = {
      sessionId: 'session-1',
      loadSourceConfig: () => ({
        slug: 'foo', name: 'Foo', type: 'api', api: { authType: 'bearer' },
      }),
      isSourceExecutionAllowed: () => false,
      callbacks: { onAuthRequest: () => { prompted = true } },
    } as unknown as SessionToolContext

    const result = await handleCredentialPrompt(ctx, { sourceSlug: 'foo', mode: 'bearer' })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('not enabled by Host settings')
    expect(prompted).toBe(false)
  })
})
