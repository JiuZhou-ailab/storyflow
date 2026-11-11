// input: Product-managed model capabilities shared by desktop bootstrap and gateway
// output: Canonical managed model definitions and safe mutable copies
// pos: Single source of truth for the Storyflow managed model catalog

import type { ModelDefinition } from './models.ts';
import type { CustomEndpointApi } from './llm-connections.ts';

export interface ManagedModelDefinition extends ModelDefinition {
  api: CustomEndpointApi;
  minimumCatalogVersion?: number;
}

export const MANAGED_MODEL_CATALOG_VERSION = '2';

/**
 * Product policy (2026-11-11): declare 90% of each vendor-documented output ceiling, rounded down.
 * Relay routes can enforce limits that differ from vendor docs, so declarations keep a margin
 * instead of sitting on the documented maximum. Arguments stay the documented ceilings.
 * Integer arithmetic keeps the result exact. Rationale: docs/model-fallback-qa.md.
 */
const OUTPUT_HEADROOM_PERCENT = 90;

function withOutputHeadroom(documentedMaxOutputTokens: number): NonNullable<ModelDefinition['fallbackCapabilities']> {
  return {
    maxOutputTokens: Math.floor(documentedMaxOutputTokens * OUTPUT_HEADROOM_PERCENT / 100),
    tools: true,
    structuredOutput: 'prompt',
  };
}

// Recovered from deployed Worker 4bbd696a (recovery/model-gateway-4bbd696a).
// Capability evidence and alias caveats: docs/model-fallback-qa.md (2026-09-16).
const DEPLOYED_MANAGED_MODEL_DEFINITIONS: readonly ManagedModelDefinition[] = [
  {
    id: 'gpt-6.1-sol',
    minimumCatalogVersion: 2,
    fallbackCapabilities: withOutputHeadroom(128_000),
    name: 'GPT-6.1 Sol',
    shortName: 'GPT',
    description: '',
    provider: 'pi',
    contextWindow: 1_050_000,
    supportsThinking: true,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    },
    supportsImages: true,
    api: 'openai-responses',
  },
  {
    id: 'gpt-5.5',
    fallbackCapabilities: withOutputHeadroom(128_000),
    name: 'GPT-5.5',
    shortName: 'GPT',
    description: '',
    provider: 'pi',
    contextWindow: 262_144,
    supportsThinking: true,
    thinkingLevelMap: {
      off: 'none',
      minimal: 'minimal',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: null,
    },
    supportsImages: true,
    api: 'openai-responses',
  },
  {
    id: 'gpt-5.6-sol',
    fallbackCapabilities: withOutputHeadroom(128_000),
    name: 'GPT-5.6 Sol',
    shortName: 'GPT',
    description: '',
    provider: 'pi',
    contextWindow: 262_144,
    supportsThinking: true,
    thinkingLevelMap: {
      off: 'none',
      minimal: 'minimal',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    },
    supportsImages: true,
    api: 'openai-responses',
  },
  {
    id: 'gpt-5.6-terra',
    fallbackCapabilities: withOutputHeadroom(128_000),
    name: 'GPT-5.6 Terra',
    shortName: 'GPT',
    description: '',
    provider: 'pi',
    contextWindow: 262_144,
    supportsThinking: true,
    thinkingLevelMap: {
      off: 'none',
      minimal: 'minimal',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    },
    supportsImages: true,
    api: 'openai-responses',
  },
  {
    id: 'gpt-5.6-luna',
    fallbackCapabilities: withOutputHeadroom(128_000),
    name: 'GPT-5.6 Luna',
    shortName: 'GPT',
    description: '',
    provider: 'pi',
    contextWindow: 262_144,
    supportsThinking: true,
    thinkingLevelMap: {
      off: 'none',
      minimal: null,
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: null,
    },
    supportsImages: true,
    api: 'openai-responses',
  },
  {
    id: 'claude-sonnet-5',
    fallbackCapabilities: withOutputHeadroom(128_000),
    name: 'Claude Sonnet 5',
    shortName: 'Claude',
    description: '',
    provider: 'anthropic',
    contextWindow: 1_000_000,
    supportsThinking: true,
    supportsImages: true,
    api: 'anthropic-messages',
  },
  {
    id: 'claude-opus-5-5',
    minimumCatalogVersion: 2,
    fallbackCapabilities: withOutputHeadroom(128_000),
    name: 'Claude Opus 5.5',
    shortName: 'Claude',
    description: '',
    provider: 'anthropic',
    contextWindow: 1_000_000,
    supportsThinking: true,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    },
    supportsImages: true,
    api: 'anthropic-messages',
  },
  {
    id: 'claude-opus-5',
    fallbackCapabilities: withOutputHeadroom(128_000),
    name: 'Claude Opus 5',
    shortName: 'Claude',
    description: '',
    provider: 'anthropic',
    contextWindow: 1_000_000,
    supportsThinking: true,
    supportsImages: true,
    api: 'anthropic-messages',
  },
  {
    id: 'gemini-3.8-flash',
    fallbackCapabilities: withOutputHeadroom(65_536),
    name: 'Gemini 3.8 Flash',
    shortName: 'Gemini',
    description: '',
    provider: 'pi',
    contextWindow: 1_000_000,
    supportsThinking: true,
    thinkingLevelMap: {
      off: null,
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: null,
      max: null,
    },
    supportsImages: true,
    api: 'google-generative-ai',
  },
  {
    id: 'gemini-4-argon',
    minimumCatalogVersion: 2,
    fallbackCapabilities: withOutputHeadroom(65_536),
    name: 'Gemini 4 Argon',
    shortName: 'Gemini',
    description: '',
    provider: 'pi',
    contextWindow: 1_048_576,
    supportsThinking: true,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: null,
      max: null,
    },
    supportsImages: true,
    api: 'google-generative-ai',
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro Preview',
    shortName: 'Gemini',
    description: '',
    provider: 'pi',
    contextWindow: 1_000_000,
    supportsThinking: true,
    thinkingLevelMap: {
      off: null,
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: null,
      max: null,
    },
    supportsImages: true,
    api: 'google-generative-ai',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    shortName: 'Gemini',
    description: '',
    provider: 'pi',
    contextWindow: 1_000_000,
    supportsThinking: true,
    thinkingLevelMap: {
      off: null,
      xhigh: null,
      max: null,
    },
    supportsImages: true,
    api: 'google-generative-ai',
  },
  {
    id: 'deepseek-v4-pro',
    fallbackCapabilities: withOutputHeadroom(384_000),
    name: 'DeepSeek V4 Pro',
    shortName: 'DeepSeek',
    description: '',
    provider: 'pi',
    contextWindow: 1_000_000,
    supportsThinking: false,
    supportsImages: false,
    api: 'openai-completions',
  },
  {
    id: 'deepseek-v4-flash',
    fallbackCapabilities: withOutputHeadroom(384_000),
    name: 'DeepSeek V4.1 Flash',
    shortName: 'DeepSeek',
    description: '',
    provider: 'pi',
    contextWindow: 1_000_000,
    supportsThinking: false,
    supportsImages: false,
    api: 'openai-completions',
  },
];

// Retain historical protocol ownership for old stored sessions, as deployed.
// Retired entries never reappear in discovery or new desktop bootstrap catalogs.
export const MANAGED_MODEL_CATALOG: readonly ManagedModelDefinition[] = DEPLOYED_MANAGED_MODEL_DEFINITIONS
  .filter(model => !isRetiredManagedModel(model.id));

/** Compatible replacement candidates still require an account-authorized catalog entry. */
export function getRetiredManagedModelReplacement(id: string, availableModelIds: Iterable<string> = []): string | undefined {
  if (!isRetiredManagedModel(id)) return undefined;
  if (id.startsWith('gpt-')) return 'gpt-5.6-sol';
  if (id.startsWith('claude-')) {
    const available = new Set(availableModelIds);
    // Old desktop caches and Sonnet-only accounts do not contain the v2 Opus ID.
    // The caller still checks availability and fails closed when neither exists.
    return ['claude-opus-5-5', 'claude-sonnet-5'].find(model => available.has(model)) ?? 'claude-opus-5-5';
  }
  return 'gemini-3.8-flash';
}

export function isRetiredManagedModel(id: string): boolean {
  return /^gemini-(?:3\.[567]|2\.5)-flash$/i.test(id) || [
    'gpt-5.5', 'gpt-5.6-terra', 'gpt-5.6-luna', 'claude-opus-5',
    'gemini-3.1-pro-preview', 'gemini-2.5-pro',
  ].includes(id);
}

/** Retire local product entries without adding models to an account-scoped catalog. */
export function applyManagedModelPolicy(models: readonly ModelDefinition[]): ModelDefinition[] {
  return models.filter(model => !isRetiredManagedModel(model.id)).map(model => ({
    ...model,
    name: MANAGED_MODEL_CATALOG.find(known => known.id === model.id)?.name ?? model.name,
  }));
}

export function getManagedDynamicModel(id: string): ManagedModelDefinition | null {
  if (isRetiredManagedModel(id) || !/^gemini-3\.6-[a-z0-9._-]+$/i.test(id)) return null;

  // ponytail: the inventory adapter currently passes IDs only; retain the Gemini-family
  // defaults until a verified upstream per-model capability contract is preserved through
  // discovery and registration. Do not infer that omitted fields mean unsupported capability.
  const name = id
    .split('-')
    .map(part => part === 'gemini' ? 'Gemini' : part.replace(/^\w/, char => char.toUpperCase()))
    .join(' ');

  return {
    id,
    name,
    shortName: 'Gemini',
    description: '',
    provider: 'pi',
    contextWindow: 1_000_000,
    supportsThinking: true,
    thinkingLevelMap: {
      off: null,
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: null,
      max: null,
    },
    supportsImages: true,
    api: 'google-generative-ai',
  };
}

export function mergeManagedModelCatalog(upstreamModelIds: Iterable<string>): ManagedModelDefinition[] {
  const catalog = MANAGED_MODEL_CATALOG.filter(model => !isRetiredManagedModel(model.id)).map(model => ({ ...model }));
  const knownIds = new Set(catalog.map(model => model.id));

  for (const id of upstreamModelIds) {
    if (knownIds.has(id)) continue;
    const model = getManagedDynamicModel(id);
    if (!model) continue;
    catalog.push(model);
    knownIds.add(id);
  }

  return catalog;
}

export function isManagedModelAllowed(id: string, api: CustomEndpointApi): boolean {
  return DEPLOYED_MANAGED_MODEL_DEFINITIONS.some(model => model.id === id && model.api === api)
    || getManagedDynamicModel(id)?.api === api;
}

export function cloneManagedModelCatalog(api?: CustomEndpointApi): ModelDefinition[] {
  return MANAGED_MODEL_CATALOG
    .filter(model => !isRetiredManagedModel(model.id) && (!api || model.api === api))
    .map(({ api: _api, ...model }) => ({
      ...model,
      ...(model.fallbackCapabilities ? { fallbackCapabilities: { ...model.fallbackCapabilities } } : {}),
      ...(model.thinkingLevelMap
        ? { thinkingLevelMap: { ...model.thinkingLevelMap } }
        : {}),
    }));
}

/** Approved candidate families; explicit per-model fallbackCapabilities are still required.
 * Discovery alone never qualifies a new model or extends these families.
 */
export const MANAGED_FALLBACK_FAMILIES = [
  ['gpt-6.1-sol', 'gpt-5.6-sol'],
  ['deepseek-v4-flash', 'deepseek-v4-pro'],
  ['claude-sonnet-5', 'claude-opus-5-5'],
  ['gemini-3.8-flash', 'gemini-4-argon'],
] as const;
