// input: OAuth connection setup RPC payloads and mocked credential persistence
// output: Regression coverage that generic setup cannot replace structured OAuth credentials
// pos: Isolated contract test for credential ownership at the LLM setup RPC boundary

import { describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

const oauthConnection = {
  slug: 'claude-max',
  name: 'Claude Max',
  providerType: 'anthropic',
  authType: 'oauth',
  models: ['claude-sonnet-4-6'],
  defaultModel: 'claude-sonnet-4-6',
  modelSelectionMode: 'userDefined3Tier',
  createdAt: 0,
} as const

let setLlmOAuthCalls = 0
let setLlmApiKeyCalls = 0
let updateLlmConnectionCalls = 0

mock.module('@craft-agent/shared/config', () => ({
  getLlmConnections: () => [oauthConnection],
  getLlmConnection: (slug: string) => slug === oauthConnection.slug ? oauthConnection : null,
  addLlmConnection: () => true,
  updateLlmConnection: () => {
    updateLlmConnectionCalls += 1
    return true
  },
  deleteLlmConnection: () => true,
  getDefaultLlmConnection: () => oauthConnection,
  setDefaultLlmConnection: () => true,
  touchLlmConnection: () => true,
  isCompatProvider: () => false,
  isAnthropicProvider: () => true,
  getDefaultModelsForConnection: () => oauthConnection.models,
  getDefaultModelForConnection: () => oauthConnection.defaultModel,
  isManagedLlmConnectionSlug: () => false,
  toBedrockNativeId: (id: string) => id,
  deriveBedrockRegionPrefix: () => undefined,
}))

mock.module('@craft-agent/shared/credentials', () => ({
  credentialIdToAccount: () => 'unused',
  getCredentialManager: () => ({
    setLlmOAuth: async () => { setLlmOAuthCalls += 1 },
    setLlmApiKey: async () => { setLlmApiKeyCalls += 1 },
  }),
}))

mock.module('@craft-agent/server-core/model-fetchers', () => ({
  getModelRefreshService: () => ({ refreshNow: async () => {} }),
}))

mock.module('@craft-agent/shared/agent/backend', () => ({
  resolveSetupTestConnectionHint: () => ({}),
  testBackendConnection: async () => ({ success: true }),
  validateStoredBackendConnection: async () => ({ success: true }),
}))

mock.module('@craft-agent/server-core/domain', () => ({
  resolveSetupTestConnectionHint: () => ({}),
  parseTestConnectionError: () => '',
  createBuiltInConnection: () => oauthConnection,
  isAppManagedConnection: () => false,
  isAppManagedConnectionAvailable: () => true,
  validateModelList: () => ({ valid: true }),
  piAuthProviderDisplayName: () => undefined,
  validateSetupTestInput: () => ({ valid: true }),
  setupTestRequiresApiKey: () => true,
  resolveCustomEndpointSetup: () => ({ authType: 'api_key' }),
}))

mock.module('@craft-agent/server-core/handlers', () => ({
  getWorkspaceOrThrow: () => { throw new Error('not used') },
  buildBackendHostRuntimeContext: () => { throw new Error('not used') },
}))

const { registerLlmConnectionsHandlers } = await import('./llm-connections')

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push() {},
    async invokeClient() {
      return undefined
    },
  }
  const deps = {
    sessionManager: {
      reinitializeAuth: async () => {},
    },
    oauthFlowStore: {},
    platform: {
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
    },
  } as unknown as HandlerDeps

  registerLlmConnectionsHandlers(server, deps)
  const setupConnection = handlers.get(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION)
  if (!setupConnection) throw new Error('LLM setup handler not registered')

  const ctx: RequestContext = {
    clientId: 'client-1',
    workspaceId: null,
    webContentsId: 1,
  }
  return { setupConnection, ctx }
}

describe('LLM connection setup OAuth credential ownership', () => {
  it('rejects a bare OAuth credential without mutating credential storage', async () => {
    setLlmOAuthCalls = 0
    setLlmApiKeyCalls = 0
    updateLlmConnectionCalls = 0
    const { setupConnection, ctx } = createHarness()

    const result = await setupConnection(ctx, {
      slug: oauthConnection.slug,
      credential: 'access-token-only',
      defaultModel: 'different-model',
    })

    expect(result).toEqual({
      success: false,
      error: 'OAuth credentials must be persisted by the provider OAuth flow.',
    })
    expect(setLlmOAuthCalls).toBe(0)
    expect(setLlmApiKeyCalls).toBe(0)
    expect(updateLlmConnectionCalls).toBe(0)
  })
})
