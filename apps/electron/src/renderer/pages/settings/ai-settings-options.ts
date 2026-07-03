// input: LLM connection metadata and localized settings labels
// output: Stable option arrays and sorted connection lists for AI settings
// pos: Pure derivation layer for AiSettingsPage connection selectors

import type { SettingsMenuSelectOption } from '@/components/settings'
import type { LlmConnectionWithStatus } from '@config/llm-connections'

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
