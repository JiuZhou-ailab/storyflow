// input: LLM connection metadata used by AI settings
// output: Regression coverage for stable connection option derivation
// pos: Keeps AI settings dropdown data shared across app defaults and workspace overrides

import { describe, expect, it } from 'bun:test'
import type { LlmConnectionWithStatus } from '@config/llm-connections'
import {
  createLlmConnectionOptions,
  createModelOptionsForConnection,
  createThinkingOptions,
  createWorkspaceModelOptions,
  createWorkspaceLlmConnectionOptions,
  sortLlmConnectionsForDisplay,
} from '../ai-settings-options'

function connection(overrides: Partial<LlmConnectionWithStatus>): LlmConnectionWithStatus {
  return {
    slug: 'conn',
    name: 'Connection',
    providerType: 'pi',
    authType: 'api_key',
    createdAt: 0,
    isAuthenticated: true,
    ...overrides,
  }
}

describe('AI settings options', () => {
  it('sorts the default connection first and then by display name', () => {
    const sorted = sortLlmConnectionsForDisplay([
      connection({ slug: 'z', name: 'Zed' }),
      connection({ slug: 'default', name: 'Middle', isDefault: true }),
      connection({ slug: 'a', name: 'Alpha' }),
    ])

    expect(sorted.map(conn => conn.slug)).toEqual(['default', 'a', 'z'])
  })

  it('derives app and workspace connection options from shared connection metadata', () => {
    const connections = [
      connection({ slug: 'anthropic', name: 'Anthropic', providerType: 'anthropic' }),
      connection({ slug: 'pi', name: 'Storyflow', providerType: 'pi' }),
      connection({ slug: 'compat', name: 'Compat', providerType: 'pi_compat' }),
    ]

    expect(createLlmConnectionOptions(connections, {
      anthropic: 'Anthropic API',
      pi: 'Storyflow Backend',
      piCompat: 'Storyflow Backend Compatible',
      unknown: 'Unknown',
    })).toEqual([
      { value: 'anthropic', label: 'Anthropic', description: 'Anthropic API' },
      { value: 'pi', label: 'Storyflow', description: 'Storyflow Backend' },
      { value: 'compat', label: 'Compat', description: 'Storyflow Backend Compatible' },
    ])

    expect(createWorkspaceLlmConnectionOptions(connections, {
      globalLabel: 'Use Default',
      globalDescription: 'Inherit from app',
      providerLabels: {
        anthropic: 'Anthropic',
        pi: 'Storyflow Backend',
        unknown: 'Unknown',
      },
    })).toEqual([
      { value: 'global', label: 'Use Default', description: 'Inherit from app' },
      { value: 'anthropic', label: 'Anthropic', description: 'Anthropic' },
      { value: 'pi', label: 'Storyflow', description: 'Storyflow Backend' },
      { value: 'compat', label: 'Compat', description: 'pi_compat' },
    ])
  })

  it('derives model options from explicit connection models and localizes descriptions', () => {
    const conn = connection({
      models: [
        'claude-opus-4-20250514',
        {
          id: 'custom-balanced',
          name: 'Balanced',
          shortName: 'Balanced',
          provider: 'pi',
          contextWindow: 128000,
          description: 'Balanced model',
          descriptionKey: 'model.balanced',
        },
      ],
    })
    const translate = (key: string) => `translated:${key}`

    expect(createModelOptionsForConnection(conn, translate)).toEqual([
      { value: 'claude-opus-4-20250514', label: 'Opus 4', description: '' },
      { value: 'custom-balanced', label: 'Balanced', description: 'translated:model.balanced' },
    ])
    expect(createWorkspaceModelOptions(conn, {
      globalLabel: 'Use Default',
      globalDescription: 'Inherit from app',
      translateDescription: translate,
    })[0]).toEqual({ value: 'global', label: 'Use Default', description: 'Inherit from app' })
  })

  it('derives thinking options with translated labels and descriptions', () => {
    expect(createThinkingOptions([
      { id: 'medium', nameKey: 'thinking.medium', descriptionKey: 'thinking.medium.desc' },
    ], (key) => `translated:${key}`)).toEqual([
      { value: 'medium', label: 'translated:thinking.medium', description: 'translated:thinking.medium.desc' },
    ])
  })
})
