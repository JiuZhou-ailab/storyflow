// input: Distribution-managed model endpoint constants
// output: Renderer setup defaults for built-in managed providers
// pos: Shared onboarding contract for provider selection and credential forms

import type { CustomEndpointApi, CustomEndpointConfig } from '@config/llm-connections'
import type { ModelDefinition } from '@config/models'

function managedModel(
  id: string,
  name: string,
  supportsThinking: boolean,
): ModelDefinition {
  return {
    id,
    name,
    shortName: name,
    description: '',
    provider: 'pi',
    contextWindow: 131_072,
    supportsThinking,
  }
}

export const JIUZHOU_MANAGED_DEFAULT_CONNECTION_MODELS: ModelDefinition[] = [
  managedModel('gpt-5.5', 'GPT-5.5', true),
  managedModel('gpt-5.6-sol', 'GPT-5.6 Sol', true),
  managedModel('gpt-5.6-terra', 'GPT-5.6 Terra', true),
  managedModel('gpt-5.6-luna', 'GPT-5.6 Luna', true),
  managedModel('gemini-3.5-flash', 'Gemini 3.5 Flash', false),
  managedModel('deepseek-v4-pro', 'DeepSeek V4 Pro', false),
  managedModel('deepseek-v4-flash', 'DeepSeek V4 Flash', false),
]

export const JIUZHOU_MANAGED_DEFAULT_MODELS =
  JIUZHOU_MANAGED_DEFAULT_CONNECTION_MODELS.map(model => model.id)

export const JIUZHOU_MANAGED_DEFAULT_BASE_URL =
  'https://storyflow-model.zjding.com/v1'

export const JIUZHOU_MANAGED_DEFAULT_MODEL = 'gpt-5.5'
export const JIUZHOU_MANAGED_DEFAULT_API: CustomEndpointApi = 'openai-completions'

export const JIUZHOU_MANAGED_DEFAULT_SETUP = {
  baseUrl: JIUZHOU_MANAGED_DEFAULT_BASE_URL,
  connectionDefaultModel: JIUZHOU_MANAGED_DEFAULT_MODEL,
  models: JIUZHOU_MANAGED_DEFAULT_CONNECTION_MODELS.map(model => ({ ...model })),
  customEndpoint: { api: JIUZHOU_MANAGED_DEFAULT_API } satisfies CustomEndpointConfig,
}

export const JIUZHOU_MANAGED_DEFAULT_INITIAL_VALUES = {
  baseUrl: JIUZHOU_MANAGED_DEFAULT_BASE_URL,
  connectionDefaultModel: JIUZHOU_MANAGED_DEFAULT_MODEL,
  activePreset: 'custom',
  models: [...JIUZHOU_MANAGED_DEFAULT_MODELS],
  customApi: JIUZHOU_MANAGED_DEFAULT_API,
}
