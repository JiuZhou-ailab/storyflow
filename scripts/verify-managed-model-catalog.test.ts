import { describe, expect, test } from 'bun:test'
import { MANAGED_MODEL_CATALOG } from '../packages/shared/src/config/managed-model-catalog'
import { verifyManagedModelCatalog } from './verify-managed-model-catalog'

const catalog = (): { data: Record<string, unknown>[] } => ({ data: MANAGED_MODEL_CATALOG.map(model => ({
  id: model.id, api: model.api, provider: model.provider, name: model.name,
  short_name: model.shortName, description: model.description, context_window: model.contextWindow,
  supports_thinking: model.supportsThinking, supports_images: model.supportsImages,
  thinking_level_map: model.thinkingLevelMap, fallback_capabilities: model.fallbackCapabilities,
})) })

describe('deployed managed catalog release gate', () => {
  test('accepts the full approved catalog', () => {
    expect(() => verifyManagedModelCatalog(catalog())).not.toThrow()
  })
  test('rejects a stale deployment even when the old Gemini canary exists', () => {
    const body = catalog()
    body.data = body.data.filter(model => model.id !== 'gemini-4-argon')
    expect(body.data.some(model => model.id === 'gemini-3.8-flash')).toBe(true)
    expect(() => verifyManagedModelCatalog(body)).toThrow('Missing managed release model: gemini-4-argon')
  })
  test('rejects truncated GPT and Claude families', () => {
    const body = catalog()
    body.data = body.data.filter(model => !['gpt-5.6-terra', 'gpt-5.6-luna', 'claude-opus-5'].includes(model.id))
    expect(() => verifyManagedModelCatalog(body)).toThrow('gpt-5.6-terra')
    expect(() => verifyManagedModelCatalog(body)).toThrow('claude-opus-5')
  })
  test('rejects empty, malformed, duplicate and protocol-incompatible catalogs', () => {
    for (const body of [{}, { data: [] }, { data: [null] }]) {
      expect(() => verifyManagedModelCatalog(body)).toThrow()
    }
    const body = catalog()
    body.data.push(body.data[0]!)
    expect(() => verifyManagedModelCatalog(body)).toThrow('Duplicate')
    const wrongProtocol = catalog()
    wrongProtocol.data[0]!.api = 'anthropic-messages'
    expect(() => verifyManagedModelCatalog(wrongProtocol)).toThrow('Incompatible')
  })
})

const malformedEntries: [string, unknown][] = [
  ['id', '   '], ['name', '   '], ['short_name', ''], ['provider', 'unknown'],
  ['description', null], ['context_window', '1000'], ['context_window', 0],
  ['context_window', 1.5], ['supports_thinking', null], ['supports_images', null], ['api', 'unknown'],
  ['thinking_level_map', null], ['thinking_level_map', []],
  ['thinking_level_map', { bogus: 'low' }], ['thinking_level_map', { low: 1 }],
  ['fallback_capabilities', null], ['fallback_capabilities', []],
  ['fallback_capabilities', { maxOutputTokens: 'unverified', tools: true, structuredOutput: 'prompt' }],
  ['fallback_capabilities', { maxOutputTokens: 0, tools: true, structuredOutput: 'prompt' }],
  ['fallback_capabilities', { maxOutputTokens: 1.5, tools: true, structuredOutput: 'prompt' }],
  ['fallback_capabilities', { maxOutputTokens: 100, tools: 'yes', structuredOutput: 'prompt' }],
  ['fallback_capabilities', { maxOutputTokens: 100, tools: true, structuredOutput: 'json' }],
]
for (const [field, value] of malformedEntries) {
  for (const extra of [false, true]) test(`rejects malformed ${field}=${JSON.stringify(value)} (extra: ${extra})`, () => {
    const body = catalog()
    const model: Record<string, unknown> = extra ? { ...body.data[0], id: 'gpt-future' } : body.data[0]!
    model[field] = value
    if (extra) body.data.push(model)
    expect(() => verifyManagedModelCatalog(body)).toThrow()
  })
}
for (const field of ['thinking_level_map', 'fallback_capabilities']) {
  test(`rejects missing approved ${field}`, () => {
    const body = catalog()
    delete body.data[0]![field]
    expect(() => verifyManagedModelCatalog(body)).toThrow('Incompatible')
  })
}
for (const [field, value] of [
  ['supports_thinking', false], ['supports_images', false],
  ['thinking_level_map', { low: 'low' }],
  ['fallback_capabilities', { maxOutputTokens: 100, tools: false, structuredOutput: 'prompt' }],
] as const) test(`rejects valid but changed approved ${field}`, () => {
  const body = catalog()
  body.data[0]![field] = value
  expect(() => verifyManagedModelCatalog(body)).toThrow('Incompatible')
})
test('accepts reordered capability keys and valid extra models without optional metadata', () => {
  const body = catalog()
  const first = body.data[0]!
  first.thinking_level_map = Object.fromEntries(Object.entries(first.thinking_level_map as object).reverse())
  first.fallback_capabilities = Object.fromEntries(Object.entries(first.fallback_capabilities as object).reverse())
  const argon = body.data.find(model => model.id === 'gemini-4-argon')!
  delete argon.fallback_capabilities
  const extra: Record<string, unknown> = { ...argon, id: 'gemini-future' }
  delete extra.thinking_level_map
  body.data.push(extra)
  expect(() => verifyManagedModelCatalog(body)).not.toThrow()
})
