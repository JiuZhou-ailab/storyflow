// input: Product-managed model capabilities shared by desktop bootstrap and gateway
// output: Canonical managed model definitions and safe mutable copies
// pos: Single source of truth for the Storyflow managed model catalog

import type { ModelDefinition } from './models.ts';

export const MANAGED_MODEL_CATALOG: readonly ModelDefinition[] = [
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    shortName: 'GPT-5',
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
  },
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    shortName: 'GPT-5',
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
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    shortName: 'GPT-5',
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
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna',
    shortName: 'GPT-5',
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
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    shortName: 'Gemini 3.5',
    description: '',
    provider: 'pi',
    contextWindow: 1_000_000,
    supportsThinking: false,
    supportsImages: true,
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    shortName: 'DeepSeek V4',
    description: '',
    provider: 'pi',
    contextWindow: 1_000_000,
    supportsThinking: false,
    supportsImages: false,
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    shortName: 'DeepSeek V4',
    description: '',
    provider: 'pi',
    contextWindow: 1_000_000,
    supportsThinking: false,
    supportsImages: false,
  },
];

export function cloneManagedModelCatalog(): ModelDefinition[] {
  return MANAGED_MODEL_CATALOG.map(model => ({
    ...model,
    ...(model.thinkingLevelMap
      ? { thinkingLevelMap: { ...model.thinkingLevelMap } }
      : {}),
  }));
}
