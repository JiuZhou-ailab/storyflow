// input: Authenticated catalog from a full-access deployment canary (never an end-user fallback)
// output: A release gate rejecting missing models and incompatible protocol metadata
// pos: Shared check for deployed gateway/client catalog compatibility
import { isDeepStrictEqual } from 'node:util'
import { MANAGED_MODEL_CATALOG, MANAGED_MODEL_CATALOG_VERSION, type ManagedModelDefinition } from '../packages/shared/src/config/managed-model-catalog'

const THINKING_LEVEL_KEYS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
const MODEL_APIS = new Set(['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'])
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

// Mirror parseManagedModelDefinition in server-core/model-fetchers/index.ts.
// The desktop parses ALL entries before protocol filtering; one bad extra model
// also invalidates the response and leaves users on their stale cached catalog.
function validateDesktopModel(entry: unknown): asserts entry is Record<string, unknown> & { id: string } {
  if (!isRecord(entry)
    || !isNonEmptyString(entry.id) || !isNonEmptyString(entry.name) || !isNonEmptyString(entry.short_name)
    || typeof entry.description !== 'string'
    || (entry.provider !== 'pi' && entry.provider !== 'anthropic')
    || typeof entry.context_window !== 'number' || !Number.isSafeInteger(entry.context_window) || entry.context_window <= 0
    || typeof entry.supports_thinking !== 'boolean' || typeof entry.supports_images !== 'boolean'
    || !MODEL_APIS.has(entry.api as string)) {
    throw new Error('Invalid managed model catalog entry')
  }
  const thinking = entry.thinking_level_map
  if (thinking !== undefined && (!isRecord(thinking)
    || Object.entries(thinking).some(([key, value]) =>
      !THINKING_LEVEL_KEYS.has(key) || (typeof value !== 'string' && value !== null)))) {
    throw new Error(`Invalid thinking level map: ${entry.id}`)
  }
  const fallback = entry.fallback_capabilities
  if (fallback !== undefined && (!isRecord(fallback)
    || typeof fallback.maxOutputTokens !== 'number' || !Number.isSafeInteger(fallback.maxOutputTokens)
    || fallback.maxOutputTokens <= 0 || typeof fallback.tools !== 'boolean' || fallback.structuredOutput !== 'prompt')) {
    throw new Error(`Invalid fallback capabilities: ${entry.id}`)
  }
}

export function verifyManagedModelCatalog(body: unknown, expectedModels: readonly ManagedModelDefinition[] = MANAGED_MODEL_CATALOG): void {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { data?: unknown }).data)) {
    throw new Error('Invalid managed model catalog')
  }
  const entries = (body as { data: unknown[] }).data
  const byId = new Map<string, Record<string, unknown>>()
  for (const entry of entries) {
    validateDesktopModel(entry)
    const model = entry
    if (byId.has(model.id)) throw new Error(`Duplicate managed model: ${model.id}`)
    byId.set(model.id, model)
  }
  const failures: string[] = []
  for (const expected of expectedModels) {
    const actual = byId.get(expected.id)
    if (!actual) {
      failures.push(`Missing managed release model: ${expected.id}`)
      continue
    }
    // These fields are required by the desktop's authenticated catalog parser.
    // Check protocol ownership too: presence alone does not prove discoverability.
    if (actual.api !== expected.api || actual.provider !== expected.provider
      || typeof actual.name !== 'string' || actual.short_name !== expected.shortName
      || typeof actual.description !== 'string'
      || !Number.isSafeInteger(actual.context_window) || Number(actual.context_window) <= 0
      || actual.supports_thinking !== expected.supportsThinking || actual.supports_images !== expected.supportsImages
      || (expected.thinkingLevelMap !== undefined && !isDeepStrictEqual(actual.thinking_level_map, expected.thinkingLevelMap))
      || (expected.fallbackCapabilities !== undefined && !isDeepStrictEqual(actual.fallback_capabilities, expected.fallbackCapabilities))) {
      failures.push(`Incompatible managed release model: ${expected.id}`)
    }
  }
  if (failures.length) throw new Error(failures.join('\n'))
}

if (import.meta.main) {
  const path = process.env.MODEL_CATALOG_RESPONSE_PATH
  if (!path) throw new Error('MODEL_CATALOG_RESPONSE_PATH is required')
  // The existing workflow already writes the broker response beside the catalog.
  // Re-fetch with the same desktop v2 negotiation rather than weakening the old gate.
  const { dirname, join } = await import('node:path')
  const tokenPath = process.env.MODEL_ACCESS_TOKEN_RESPONSE_PATH ?? join(dirname(path), 'token-response.json')
  const { modelAccessToken } = await Bun.file(tokenPath).json()
  if (typeof modelAccessToken !== 'string' || !modelAccessToken) throw new Error('Missing canary model capability')
  const { verifyManagedModelsLive } = await import('./verify-managed-models-live')
  await verifyManagedModelsLive(modelAccessToken)
  console.log(`Verified managed catalog v${MANAGED_MODEL_CATALOG_VERSION} and all native model calls`)
}
