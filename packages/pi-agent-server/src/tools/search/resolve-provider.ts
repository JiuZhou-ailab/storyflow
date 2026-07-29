// input: Model-provider authentication, custom-endpoint mode, and AnySearch credentials
// output: A web search provider that never crosses model-provider credential boundaries
// pos: Trust-boundary router for Storyflow's typed web_search capability

import type { WebSearchProvider } from './types.ts';
import { ResponsesApiSearchProvider } from './providers/openai.ts';
import { ChatGPTBackendSearchProvider, extractChatGptAccountId } from './providers/chatgpt.ts';
import { GoogleSearchProvider } from './providers/google.ts';
import { DDGSearchProvider } from './providers/ddg.ts';

export type SearchProviderCredential =
  | { type: 'api_key'; key: string }
  | { type: 'oauth'; access: string; refresh: string; expires: number }
  | { type: string; key?: string; access?: string };

export interface SearchProviderAuthConfig {
  provider?: string;
  credential?: SearchProviderCredential;
}

const ANYSEARCH_ENDPOINT = 'https://api.anysearch.com/mcp';

interface AnySearchResponse {
  error?: { message?: string };
  result?: {
    content?: Array<{ type?: string; text?: string }>;
  };
}

export class AnySearchProvider implements WebSearchProvider {
  name = 'AnySearch';

  async search(query: string, count: number) {
    const apiKey = process.env.ANYSEARCH_API_KEY;
    const response = await fetch(ANYSEARCH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Anysearch-Client': 'storyflow/web-search',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'search',
          arguments: { query, max_results: count },
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`AnySearch failed (HTTP ${response.status})`);
    }

    const data = await response.json() as AnySearchResponse;
    if (data.error) {
      throw new Error(data.error.message || 'AnySearch returned an unknown error');
    }

    const text = data.result?.content
      ?.filter((item) => item.type === 'text' && item.text)
      .map((item) => item.text)
      .join('\n\n');
    if (!text) {
      throw new Error('AnySearch returned no text results');
    }

    return [{ title: 'AnySearch results', url: '', description: text }];
  }
}

function getApiKey(piAuth?: SearchProviderAuthConfig): string | undefined {
  if (piAuth?.credential?.type !== 'api_key') return undefined;
  return typeof piAuth.credential.key === 'string' && piAuth.credential.key.length > 0
    ? piAuth.credential.key
    : undefined;
}

function getOAuthAccess(piAuth?: SearchProviderAuthConfig): string | undefined {
  if (piAuth?.credential?.type !== 'oauth') return undefined;
  const access = (piAuth.credential as { access?: string }).access;
  return typeof access === 'string' && access.length > 0 ? access : undefined;
}

/**
 * openai-codex tokens may arrive as either:
 *  - oauth.access (legacy/explicit oauth shape), or
 *  - api_key.key (current runtime shape for ChatGPT Plus OAuth bearer token)
 */
function getOpenAiCodexAccessToken(piAuth?: SearchProviderAuthConfig): string | undefined {
  if (piAuth?.provider !== 'openai-codex') return undefined;
  return getOAuthAccess(piAuth) ?? getApiKey(piAuth);
}

export function resolveSearchProvider(
  piAuth?: SearchProviderAuthConfig,
  customEndpoint = false,
): WebSearchProvider {
  // A custom endpoint's auth shape may say "openai", but its credential belongs
  // only to that endpoint and must never be sent to api.openai.com.
  if (customEndpoint) {
    return new AnySearchProvider();
  }

  const provider = piAuth?.provider;
  const apiKey = getApiKey(piAuth);
  const openAiCodexAccess = getOpenAiCodexAccessToken(piAuth);

  // OpenAI with API key → standard Responses API
  if (provider === 'openai' && apiKey) {
    return new ResponsesApiSearchProvider({
      apiBase: 'https://api.openai.com/v1',
      apiKey,
    });
  }

  // ChatGPT Plus (OpenAI OAuth bearer token) → ChatGPT backend endpoint
  // Supports both oauth.access and api_key.key token shapes.
  if (provider === 'openai-codex' && openAiCodexAccess) {
    const accountId = extractChatGptAccountId(openAiCodexAccess);
    if (accountId) {
      return new ChatGPTBackendSearchProvider(openAiCodexAccess, accountId);
    }
    // Can't extract accountId (malformed/non-JWT token) → fall through to DDG
  }

  // OpenRouter → same Responses API format, different base URL
  if (provider === 'openrouter' && apiKey) {
    return new ResponsesApiSearchProvider({
      apiBase: 'https://openrouter.ai/api/v1',
      apiKey,
      model: 'openai/gpt-4o-mini',
    });
  }

  // Google → Gemini API with native Google Search grounding
  if (provider === 'google' && apiKey) {
    return new GoogleSearchProvider(apiKey);
  }

  // Vercel AI Gateway is currently not wired to provider-native search routing.
  // It intentionally falls back to DDG until we add an explicit Responses API mapping.

  // Universal fallback — no API key required
  return new DDGSearchProvider();
}
