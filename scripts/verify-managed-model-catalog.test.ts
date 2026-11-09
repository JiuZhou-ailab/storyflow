import { describe, expect, test } from 'bun:test'
import { MANAGED_MODEL_CATALOG } from '../packages/shared/src/config/managed-model-catalog'
import { verifyManagedModelCatalog } from './verify-managed-model-catalog'

const catalog = () => ({ data: MANAGED_MODEL_CATALOG.map(model => ({
  id: model.id, api: model.api, provider: model.provider, name: model.name,
  short_name: model.shortName, description: model.description, context_window: model.contextWindow,
  supports_thinking: model.supportsThinking, supports_images: model.supportsImages,
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
