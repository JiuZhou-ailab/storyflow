// input: Pi runtime paths, connection resolution, credentials, and model metadata
// output: Shared data contracts for direct Pi runtime construction and model discovery
// pos: Internal configuration boundary between Storyflow session orchestration and Pi

import type { AgentProvider, BackendConfig, LlmAuthType, LlmProviderType } from '../types.ts';
import type { LlmConnection } from '../../../config/storage.ts';
import type { CustomEndpointConfig } from '../../../config/llm-connections.ts';
import type { ModelThinkingLevelMap } from '../../../config/models.ts';

export interface BackendRuntimePaths {
  copilotCli?: string;
  node?: string;
  bridgeServer?: string;
  piServer?: string;
}

export interface BackendRuntimePayload extends Record<string, unknown> {
  paths?: BackendRuntimePaths;
  piAuthProvider?: string;
  /** Custom base URL from the LLM connection (e.g. Azure OpenAI endpoint). */
  baseUrl?: string;
  /** Custom endpoint protocol config (api type for routing). */
  customEndpoint?: CustomEndpointConfig;
  /** Models registered for a custom endpoint. Strings default to 128K context; objects allow overrides. */
  customModels?: Array<string | {
    id: string;
    contextWindow?: number;
    supportsImages?: boolean;
    supportsThinking?: boolean;
    thinkingLevelMap?: ModelThinkingLevelMap;
  }>;
}

export interface BackendResolutionContext {
  connection: LlmConnection | null;
  authType?: LlmAuthType;
  resolvedModel: string;
}

export interface BackendProviderOptions {
  piAuthProvider?: string;
}

export interface BackendModelFetchCredentials {
  apiKey?: string;
  oauthAccessToken?: string;
  oauthRefreshToken?: string;
  oauthIdToken?: string;
}

export interface StoredConnectionValidationResult {
  success: boolean;
  error?: string;
  shouldRefreshModels?: boolean;
}

/**
 * Internal resolved config consumed by concrete backend implementations.
 */
export interface ResolvedBackendConfig extends BackendConfig {
  runtime?: BackendRuntimePayload;
}

export function getBackendRuntime(config: BackendConfig): BackendRuntimePayload {
  return (config.runtime ?? {}) as BackendRuntimePayload;
}

export function getDefaultProviderType(provider: AgentProvider): LlmProviderType {
  switch (provider) {
    case 'anthropic':
      return 'anthropic';
    case 'pi':
      return 'pi';
  }
}
