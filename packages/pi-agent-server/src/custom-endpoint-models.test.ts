import { describe, expect, it } from 'bun:test'
import {
  buildCustomEndpointModelDef,
  normalizeCustomEndpointModelEntry,
  resolveCustomEndpointProviderName,
  shouldUseCustomEndpointBearerAuthHeader,
  resolveCustomEndpointProviderApiKey,
  stripPiPrefix,
} from './custom-endpoint-models.ts'

describe('normalizeCustomEndpointModelEntry', () => {
  it('strips pi/ prefixes from string model IDs', () => {
    expect(stripPiPrefix('pi/my-model')).toBe('my-model')
    expect(normalizeCustomEndpointModelEntry('pi/my-model')).toEqual({ id: 'my-model' })
  })

  it('preserves per-model image support when enabled', () => {
    expect(normalizeCustomEndpointModelEntry({
      id: 'pi/vision-model',
      supportsImages: true,
    })).toEqual({
      id: 'vision-model',
      supportsImages: true,
    })
  })

  it('preserves explicit per-model image support when disabled', () => {
    expect(normalizeCustomEndpointModelEntry({
      id: 'pi/text-only-model',
      supportsImages: false,
    })).toEqual({
      id: 'text-only-model',
      supportsImages: false,
    })
  })

  it('preserves context window and image support together', () => {
    expect(normalizeCustomEndpointModelEntry({
      id: 'pi/vision-model',
      contextWindow: 262_144,
      supportsImages: true,
    })).toEqual({
      id: 'vision-model',
      contextWindow: 262_144,
      supportsImages: true,
    })
  })
})

describe('buildCustomEndpointModelDef', () => {
  it('defaults custom endpoint models to text-only input', () => {
    const model = buildCustomEndpointModelDef('my-model')
    expect(model.input).toEqual(['text'])
  })

  it('enables image input when the connection explicitly opts in', () => {
    const model = buildCustomEndpointModelDef('vision-model', { supportsImages: true })
    expect(model.input).toEqual(['text', 'image'])
  })

  it('lets per-model overrides disable image input even when the connection default is enabled', () => {
    const model = buildCustomEndpointModelDef('text-only-model', { supportsImages: true }, { supportsImages: false })
    expect(model.input).toEqual(['text'])
  })

  it('lets per-model overrides enable image input and custom context window', () => {
    const model = buildCustomEndpointModelDef('vision-model', undefined, { supportsImages: true, contextWindow: 262_144 })
    expect(model.input).toEqual(['text', 'image'])
    expect(model.contextWindow).toBe(262_144)
  })
})

describe('resolveCustomEndpointProviderApiKey', () => {
  it('uses the configured API key when present', () => {
    expect(resolveCustomEndpointProviderApiKey({
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com/v1',
    })).toBe('sk-test')
  })

  it('uses a placeholder for keyless custom endpoints so Pi can register models', () => {
    expect(resolveCustomEndpointProviderApiKey({
      apiKey: '',
      baseUrl: 'https://keyless.example.com/v1',
      authType: 'none',
    })).toBe('not-needed')
  })

  it('uses a placeholder for local endpoints that do not require auth', () => {
    expect(resolveCustomEndpointProviderApiKey({
      apiKey: '',
      baseUrl: 'http://127.0.0.1:11434/v1',
    })).toBe('not-needed')
  })
})

describe('resolveCustomEndpointProviderName', () => {
  it('uses the normal synthetic provider for generic compatible endpoints', () => {
    expect(resolveCustomEndpointProviderName('openai')).toBe('custom-endpoint')
    expect(resolveCustomEndpointProviderName(undefined)).toBe('custom-endpoint')
  })

  it('keeps Cloudflare AI Gateway models under the Cloudflare provider', () => {
    expect(resolveCustomEndpointProviderName('cloudflare-ai-gateway')).toBe('cloudflare-ai-gateway')
  })
})

describe('shouldUseCustomEndpointBearerAuthHeader', () => {
  it('lets Cloudflare AI Gateway attach cf-aig-authorization itself', () => {
    expect(shouldUseCustomEndpointBearerAuthHeader('cloudflare-ai-gateway')).toBe(false)
  })

  it('keeps Authorization bearer auth for generic compatible endpoints', () => {
    expect(shouldUseCustomEndpointBearerAuthHeader('custom-endpoint')).toBe(true)
  })
})
