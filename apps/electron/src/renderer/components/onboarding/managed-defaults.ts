// input: Distribution-managed model endpoint constants
// output: Renderer setup defaults for built-in managed providers
// pos: Shared onboarding contract for provider selection and credential forms

import type { CustomEndpointApi, CustomEndpointConfig } from '@config/llm-connections'

export const JIUZHOU_MANAGED_DEFAULT_MODELS = [
  'gemini-3.5-flash',
  'gpt-5.5',
  'deepseek-v4-pro',
] as const

export const JIUZHOU_MANAGED_DEFAULT_BASE_URL =
  'https://gateway.ai.cloudflare.com/v1/ec286cbbbae1647af670efd1b3289631/default/custom-wangsu/v1/17d9ef9735d84a4d37fb44efa49d8148/yewu4'

export const JIUZHOU_MANAGED_DEFAULT_MODEL = 'gpt-5.5'
export const JIUZHOU_MANAGED_DEFAULT_API: CustomEndpointApi = 'openai-completions'

export const JIUZHOU_MANAGED_DEFAULT_SETUP = {
  baseUrl: JIUZHOU_MANAGED_DEFAULT_BASE_URL,
  connectionDefaultModel: JIUZHOU_MANAGED_DEFAULT_MODEL,
  models: [...JIUZHOU_MANAGED_DEFAULT_MODELS],
  customEndpoint: { api: JIUZHOU_MANAGED_DEFAULT_API } satisfies CustomEndpointConfig,
}

export const JIUZHOU_MANAGED_DEFAULT_INITIAL_VALUES = {
  baseUrl: JIUZHOU_MANAGED_DEFAULT_BASE_URL,
  connectionDefaultModel: JIUZHOU_MANAGED_DEFAULT_MODEL,
  activePreset: 'custom',
  models: [...JIUZHOU_MANAGED_DEFAULT_MODELS],
  customApi: JIUZHOU_MANAGED_DEFAULT_API,
}
