// input: Automatic callback and manual-code completion of one Pi OAuth flow
// output: Proof that exactly one product credential write owns each completion path
// pos: Isolated contract test for the onboarding-to-Pi OAuth bridge

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

const tokens = {
  accessToken: 'pi-access',
  refreshToken: 'pi-refresh',
  expiresAt: 123456,
}

let resolveCompletion!: (value: typeof tokens) => void
let completion!: Promise<typeof tokens>
let codeSubmitted = false
let cancelled = false
let setLlmOAuthCalls = 0

function resetFlow(): void {
  completion = new Promise(resolve => { resolveCompletion = resolve })
  codeSubmitted = false
  cancelled = false
  setLlmOAuthCalls = 0
}

mock.module('@craft-agent/shared/auth', () => ({
  getAuthState: async () => ({}),
  getSetupNeeds: () => ({}),
  prepareMcpOAuth: async () => ({}),
  prepareClaudeOAuth: async () => ({
    authUrl: 'https://example.test/authorize',
    completion,
    wasCodeSubmitted: () => codeSubmitted,
    wasCancelled: () => cancelled,
  }),
  exchangeClaudeCode: async () => {
    codeSubmitted = true
    resolveCompletion(tokens)
    return completion
  },
  hasValidOAuthState: () => !cancelled,
  clearOAuthState: () => { cancelled = true },
}))

mock.module('@craft-agent/shared/credentials', () => ({
  getCredentialManager: () => ({
    setLlmOAuth: async () => { setLlmOAuthCalls += 1 },
  }),
}))

mock.module('@craft-agent/shared/config', () => ({
  isSetupDeferred: () => false,
  setSetupDeferred: () => {},
}))

mock.module('@craft-agent/shared/mcp', () => ({
  validateMcpConnection: async () => ({ success: true }),
}))

const { registerOnboardingHandlers } = await import('./onboarding')

function createHarness(): {
  start: HandlerFn
  exchange: HandlerFn
  ctx: RequestContext
  pushed: Array<{ channel: string, args: unknown[] }>
} {
  const handlers = new Map<string, HandlerFn>()
  const pushed: Array<{ channel: string, args: unknown[] }> = []
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push(channel, _target, ...args) { pushed.push({ channel, args }) },
    async invokeClient() { return undefined },
  }
  const deps = {
    oauthFlowStore: {},
    platform: {
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    },
  } as unknown as HandlerDeps
  registerOnboardingHandlers(server, deps)

  const start = handlers.get(RPC_CHANNELS.onboarding.START_CLAUDE_OAUTH)
  const exchange = handlers.get(RPC_CHANNELS.onboarding.EXCHANGE_CLAUDE_CODE)
  if (!start || !exchange) throw new Error('Claude OAuth handlers not registered')
  return {
    start,
    exchange,
    ctx: { clientId: 'client-1', workspaceId: null, webContentsId: 1 },
    pushed,
  }
}

beforeEach(resetFlow)

describe('onboarding Pi OAuth completion ownership', () => {
  it('persists and pushes an automatic callback exactly once', async () => {
    const { start, ctx, pushed } = createHarness()

    expect(await start(ctx, 'claude-max')).toEqual({
      success: true,
      authUrl: 'https://example.test/authorize',
    })
    resolveCompletion(tokens)
    await completion
    await Promise.resolve()
    await Promise.resolve()

    expect(setLlmOAuthCalls).toBe(1)
    expect(pushed).toEqual([{
      channel: RPC_CHANNELS.onboarding.CLAUDE_OAUTH_COMPLETED,
      args: [{ connectionSlug: 'claude-max', success: true }],
    }])
  })

  it('lets manual submission own the same Pi completion without a second write', async () => {
    const { start, exchange, ctx, pushed } = createHarness()

    await start(ctx, 'claude-max')
    expect(await exchange(ctx, 'copied-code', 'claude-max')).toEqual({ success: true })
    await Promise.resolve()

    expect(codeSubmitted).toBe(true)
    expect(setLlmOAuthCalls).toBe(1)
    expect(pushed).toEqual([])
  })
})
