// input: A CI broker-issued canary capability (never logged or persisted here).
// output: Native per-model generation checks for both published and v2 catalogs.
// pos: Real-call deployment gate shared by the existing managed-auth workflow.
import { MANAGED_MODEL_CATALOG, MANAGED_MODEL_CATALOG_VERSION, isRetiredManagedModel } from '../packages/shared/src/config/managed-model-catalog'
import { verifyManagedModelCatalog } from './verify-managed-model-catalog'
import { PiModelRuntime } from '../packages/pi-agent-server/src/pi-model-runtime'
import type { PiInitMessage } from '../packages/shared/src/agent/backend/pi/protocol'
import type { CustomEndpointApi, ModelDefinition } from '../packages/shared/src/config'

type Fetch = typeof fetch
export async function verifyManagedModelsLive(token: string, fetchImpl: Fetch = fetch, gateway = 'https://storyflow-model.zjding.com'): Promise<void> {
  const headers = { Authorization: `Bearer ${token}`, 'x-storyflow-model-catalog-version': MANAGED_MODEL_CATALOG_VERSION }
  const response = await fetchImpl(`${gateway}/v1/models`, { headers, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`v2 catalog HTTP ${response.status}`)
  const catalog = await response.json() as { data: Array<{ id: string; api: string }> }
  verifyManagedModelCatalog(catalog)
  const oldResponse = await fetchImpl(`${gateway}/v1/models`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
  })
  if (!oldResponse.ok) throw new Error(`Legacy catalog HTTP ${oldResponse.status}`)
  const oldCatalog = await oldResponse.json() as { data: Array<{ id: string }> }
  verifyManagedModelCatalog(oldCatalog, MANAGED_MODEL_CATALOG.filter(model => !model.minimumCatalogVersion))
  const expectedLegacy = catalog.data.filter(model => !MANAGED_MODEL_CATALOG.find(known => known.id === model.id)?.minimumCatalogVersion).map(model => model.id).sort()
  if (!Array.isArray(oldCatalog.data) || JSON.stringify(oldCatalog.data.map(model => model.id).sort()) !== JSON.stringify(expectedLegacy)) {
    throw new Error('Legacy desktop catalog changed unexpectedly')
  }
  for (const model of catalog.data) {
    if (isRetiredManagedModel(model.id)) throw new Error(`Retired model exposed: ${model.id}`)
    const api = model.api as CustomEndpointApi
    const raw = catalog.data.find(entry => entry.id === model.id)! as unknown as Record<string, unknown>
    const definition: ModelDefinition = {
      id: model.id, name: String(raw.name), shortName: String(raw.short_name), description: String(raw.description),
      provider: raw.provider as ModelDefinition['provider'], contextWindow: Number(raw.context_window),
      supportsThinking: Boolean(raw.supports_thinking), supportsImages: Boolean(raw.supports_images),
      thinkingLevelMap: raw.thinking_level_map as ModelDefinition['thinkingLevelMap'],
      fallbackCapabilities: raw.fallback_capabilities as ModelDefinition['fallbackCapabilities'],
    }
    const config: PiInitMessage = {
      type: 'init', apiKey: token, model: model.id, cwd: process.cwd(), thinkingLevel: 'low',
      workspaceRootPath: '', sessionId: 'model-canary', sessionPath: '', workingDirectory: process.cwd(), plansFolderPath: '',
      baseUrl: `${gateway}${api === 'google-generative-ai' ? '/v1beta' : api === 'anthropic-messages' ? '' : '/v1'}`,
      customEndpoint: { api }, customModels: [definition], managedConnection: { slug: 'storyflow-managed', autoFallback: false },
    }
    const runtime = new PiModelRuntime(() => config, () => {}, () => {})
    const models = await runtime.getModelsRuntime()
    const native = runtime.resolveModel(models, model.id, 'model-canary')
    if (!native) throw new Error(`Native model registration failed: ${model.id}`)
    const result = await models.completeSimple(native, {
      messages: [{ role: 'user', content: 'Reply with OK.', timestamp: Date.now() }],
    }, { reasoning: 'low', maxTokens: 4096, maxRetries: 0, signal: AbortSignal.timeout(90_000) })
    // Never print provider errors or bodies: they may reflect request credentials.
    if (result.stopReason === 'error' || result.stopReason === 'aborted'
      || !result.content.some(block => block.type === 'text' && block.text.trim())) {
      throw new Error(`Model canary ${model.id} (${model.api}) did not generate text (${result.stopReason})`)
    }
    console.log(`Model canary OK: ${model.id} (${model.api})`)
  }
  console.log(`Verified ${catalog.data.length} native generation calls; legacy desktop catalog: ${expectedLegacy.join(', ')}`)
}
