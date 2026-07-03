// input: LLM connection metadata and localized settings labels
// output: Stable option arrays and sorted connection lists for AI settings
// pos: Pure derivation layer for AiSettingsPage connection selectors

import type { SettingsMenuSelectOption } from '@/components/settings'
import { getModelShortName, type ModelDefinition } from '@config/models'
import { getModelsForProviderType, type LlmConnectionWithStatus } from '@config/llm-connections'

export interface ProviderDescriptionLabels {
  anthropic?: string
  pi?: string
  piCompat?: string
  unknown?: string
}

export interface WorkspaceConnectionOptionsConfig {
  globalLabel: string
  globalDescription: string
  providerLabels: ProviderDescriptionLabels
}

export interface WorkspaceModelOptionsConfig {
  globalLabel: string
  globalDescription: string
  translateDescription: (key: string) => string
}

export interface ThinkingOptionConfig {
  id: string
  nameKey: string
  descriptionKey: string
}

export function sortLlmConnectionsForDisplay(connections: LlmConnectionWithStatus[]): LlmConnectionWithStatus[] {
  return [...connections].sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1
    if (!a.isDefault && b.isDefault) return 1
    return a.name.localeCompare(b.name)
  })
}

export function createLlmConnectionOptions(
  connections: LlmConnectionWithStatus[],
  labels: ProviderDescriptionLabels,
): SettingsMenuSelectOption[] {
  return connections.map((connection) => ({
    value: connection.slug,
    label: connection.name,
    description: getProviderDescription(connection, labels),
  }))
}

export function createWorkspaceLlmConnectionOptions(
  connections: LlmConnectionWithStatus[],
  config: WorkspaceConnectionOptionsConfig,
): SettingsMenuSelectOption[] {
  return [
    { value: 'global', label: config.globalLabel, description: config.globalDescription },
    ...createLlmConnectionOptions(connections, config.providerLabels),
  ]
}

export function createModelOptionsForConnection(
  connection: LlmConnectionWithStatus | undefined,
  translateDescription: (key: string) => string,
): SettingsMenuSelectOption[] {
  if (!connection) return []

  const models = connection.models && connection.models.length > 0
    ? connection.models
    : getModelsForProviderType(connection.providerType, connection.piAuthProvider)

  return models.map((model) => {
    if (typeof model === 'string') {
      return { value: model, label: getModelShortName(model), description: '' }
    }
    const definition = model as ModelDefinition
    return {
      value: definition.id,
      label: definition.name,
      description: definition.descriptionKey ? translateDescription(definition.descriptionKey) : definition.description,
    }
  })
}

export function createWorkspaceModelOptions(
  connection: LlmConnectionWithStatus | undefined,
  config: WorkspaceModelOptionsConfig,
): SettingsMenuSelectOption[] {
  return [
    { value: 'global', label: config.globalLabel, description: config.globalDescription },
    ...createModelOptionsForConnection(connection, config.translateDescription),
  ]
}

export function createThinkingOptions(
  levels: readonly ThinkingOptionConfig[],
  translate: (key: string) => string,
): SettingsMenuSelectOption[] {
  return levels.map(({ id, nameKey, descriptionKey }) => ({
    value: id,
    label: translate(nameKey),
    description: translate(descriptionKey),
  }))
}

function getProviderDescription(
  connection: LlmConnectionWithStatus,
  labels: ProviderDescriptionLabels,
): string {
  switch (connection.providerType) {
    case 'anthropic':
      return labels.anthropic ?? connection.providerType
    case 'pi':
      return labels.pi ?? connection.providerType
    case 'pi_compat':
      return labels.piCompat ?? connection.providerType
    default:
      return connection.providerType || labels.unknown || 'Unknown'
  }
}
