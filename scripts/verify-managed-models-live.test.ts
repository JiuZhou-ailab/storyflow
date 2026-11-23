import { expect, test } from 'bun:test'
import { MANAGED_MODEL_CATALOG } from '../packages/shared/src/config/managed-model-catalog'
import { verifyManagedModelsLive } from './verify-managed-models-live'
import { protocolCompletion } from '../packages/pi-agent-server/src/managed-fallback.fixture'

test('deployment gate calls every catalog model using the desktop native protocol and metadata', async () => {
  const calls: Array<{ id: string; path: string; body: any }> = []
  const catalogVersions: Array<string | null> = []
  let leakHydrogenIntoV2 = false
  const catalog = MANAGED_MODEL_CATALOG.map(model => ({
    id: model.id, name: model.name, short_name: model.shortName, description: model.description,
    provider: model.provider, context_window: model.contextWindow, supports_thinking: model.supportsThinking,
    supports_images: model.supportsImages, thinking_level_map: model.thinkingLevelMap,
    fallback_capabilities: model.fallbackCapabilities, api: model.api,
  }))
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/v1/models') {
      expect(request.headers.get('authorization')).toBe('Bearer local-canary')
      const version = request.headers.get('x-storyflow-model-catalog-version')
      catalogVersions.push(version)
      const catalogVersion = version === '2' && leakHydrogenIntoV2 ? 3 : Number(version ?? 1)
      return Response.json({ data: catalog.filter((_, index) =>
        (MANAGED_MODEL_CATALOG[index]?.minimumCatalogVersion ?? 1) <= catalogVersion) })
    }
    const body = await request.json() as any
    const id = body.model ?? /\/models\/([^:]+):/.exec(path)?.[1]
    const model = MANAGED_MODEL_CATALOG.find(model => model.id === id)!
    expect(model).toBeDefined()
    calls.push({ id, path, body })
    if (model.api === 'google-generative-ai') {
      expect(request.headers.get('x-goog-api-key')).toBe('local-canary')
      expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe('LOW')
      expect(body.generationConfig.thinkingConfig.thinkingBudget).toBeUndefined()
    } else if (model.api === 'anthropic-messages') {
      expect(request.headers.get('x-api-key')).toBe('local-canary')
      if (id === 'claude-opus-5-5') expect(body.thinking.type).toBe('adaptive')
    } else expect(request.headers.get('authorization')).toBe('Bearer local-canary')
    return protocolCompletion(model.api, id)
  } })
  try {
    await verifyManagedModelsLive('local-canary', fetch, `http://127.0.0.1:${server.port}`)
    expect(catalogVersions).toEqual(['3', null, '2'])
    expect(calls.map(call => call.id)).toEqual(MANAGED_MODEL_CATALOG.map(model => model.id))
    expect(calls.find(call => call.id === 'gpt-6.1-sol')?.path).toBe('/v1/responses')
    expect(calls.find(call => call.id === 'claude-opus-5-5')?.path).toBe('/v1/messages')
    const hydrogenCall = calls.find(call => call.id === 'gemini-4-hydrogen')
    expect(hydrogenCall?.path).toContain('gemini-4-hydrogen:')
    expect(hydrogenCall?.body.generationConfig.maxOutputTokens).toBe(58_982)
    leakHydrogenIntoV2 = true
    await expect(verifyManagedModelsLive('local-canary', fetch, `http://127.0.0.1:${server.port}`))
      .rejects.toThrow('v2 desktop catalog changed unexpectedly')
  } finally { server.stop(true) }
}, 30_000)
