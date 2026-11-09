// input: Authenticated catalog from a full-access deployment canary (never an end-user fallback)
// output: A release gate rejecting missing models and incompatible protocol metadata
// pos: Shared check for deployed gateway/client catalog compatibility
import { MANAGED_MODEL_CATALOG } from '../packages/shared/src/config/managed-model-catalog'

export function verifyManagedModelCatalog(body: unknown): void {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { data?: unknown }).data)) {
    throw new Error('Invalid managed model catalog')
  }
  const entries = (body as { data: unknown[] }).data
  const byId = new Map<string, Record<string, unknown>>()
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || typeof (entry as { id?: unknown }).id !== 'string') {
      throw new Error('Invalid managed model catalog entry')
    }
    const model = entry as Record<string, unknown> & { id: string }
    if (byId.has(model.id)) throw new Error(`Duplicate managed model: ${model.id}`)
    byId.set(model.id, model)
  }
  const failures: string[] = []
  for (const expected of MANAGED_MODEL_CATALOG) {
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
      || typeof actual.supports_thinking !== 'boolean' || typeof actual.supports_images !== 'boolean') {
      failures.push(`Incompatible managed release model: ${expected.id}`)
    }
  }
  if (failures.length) throw new Error(failures.join('\n'))
}

if (import.meta.main) {
  const path = process.env.MODEL_CATALOG_RESPONSE_PATH
  if (!path) throw new Error('MODEL_CATALOG_RESPONSE_PATH is required')
  verifyManagedModelCatalog(await Bun.file(path).json())
  console.log(`Verified ${MANAGED_MODEL_CATALOG.length} managed release models and protocol metadata`)
}
