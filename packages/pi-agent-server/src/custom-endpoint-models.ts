export type CustomEndpointInput = 'text' | 'image'

export interface CustomEndpointModelDefaults {
  supportsImages?: boolean
}

export interface CustomEndpointModelOverrides {
  contextWindow?: number
  supportsImages?: boolean
}

export interface CustomEndpointModelEntry extends CustomEndpointModelOverrides {
  id: string
}

export type CustomEndpointModelConfig = string | {
  id: string
  contextWindow?: number
  supportsImages?: boolean
}

export interface CustomEndpointProviderApiKeyInput {
  apiKey?: string
  baseUrl?: string
  authType?: string
}

export const KEYLESS_CUSTOM_ENDPOINT_API_KEY = 'not-needed'
export const CUSTOM_ENDPOINT_PROVIDER_NAME = 'custom-endpoint'
export const CLOUDFLARE_AI_GATEWAY_PROVIDER_NAME = 'cloudflare-ai-gateway'

/** Strip bare model IDs (remove pi/ prefix if present). */
export function stripPiPrefix(id: string): string {
  return id.startsWith('pi/') ? id.slice(3) : id
}

/**
 * Pi requires custom providers that define models to include a truthy apiKey
 * unless they use SDK-owned OAuth. Keyless local/proxy endpoints still need a
 * stable placeholder so registration can complete before the real request path
 * decides whether auth matters.
 */
export function resolveCustomEndpointProviderApiKey(input: CustomEndpointProviderApiKeyInput): string {
  const key = input.apiKey?.trim()
  return key || KEYLESS_CUSTOM_ENDPOINT_API_KEY
}

/**
 * Cloudflare AI Gateway has first-class header handling inside Pi's
 * OpenAI-compatible adapter. Keep managed Cloudflare custom models on that
 * provider instead of the generic synthetic provider so requests use
 * cf-aig-authorization instead of Authorization.
 */
export function resolveCustomEndpointProviderName(piAuthProvider: string | undefined): string {
  return piAuthProvider === CLOUDFLARE_AI_GATEWAY_PROVIDER_NAME
    ? CLOUDFLARE_AI_GATEWAY_PROVIDER_NAME
    : CUSTOM_ENDPOINT_PROVIDER_NAME
}

export function shouldUseCustomEndpointBearerAuthHeader(providerName: string): boolean {
  return providerName !== CLOUDFLARE_AI_GATEWAY_PROVIDER_NAME
}

/**
 * Normalize a user-configured custom endpoint model for Pi SDK registration.
 *
 * Keep explicit per-model capability overrides intact. In particular,
 * `supportsImages: false` is meaningful because it can override a global
 * endpoint default of `supportsImages: true` for text-only models.
 */
export function normalizeCustomEndpointModelEntry(model: CustomEndpointModelConfig): CustomEndpointModelEntry {
  if (typeof model === 'string') {
    return { id: stripPiPrefix(model) }
  }

  return {
    id: stripPiPrefix(model.id),
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.supportsImages !== undefined ? { supportsImages: model.supportsImages } : {}),
  }
}

/**
 * Build a synthetic model definition for a custom endpoint.
 * Uses reasonable defaults for context window and max tokens since we can't
 * query the endpoint for its actual capabilities. Image support must be
 * explicitly enabled either at the connection level or per-model.
 */
export function buildCustomEndpointModelDef(
  id: string,
  defaults?: CustomEndpointModelDefaults,
  overrides?: CustomEndpointModelOverrides,
) {
  const supportsImages = overrides?.supportsImages ?? defaults?.supportsImages ?? false
  const input: CustomEndpointInput[] = supportsImages ? ['text', 'image'] : ['text']

  return {
    id,
    name: id,
    reasoning: false,
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: overrides?.contextWindow ?? 131_072,
    maxTokens: 8_192,
  }
}
