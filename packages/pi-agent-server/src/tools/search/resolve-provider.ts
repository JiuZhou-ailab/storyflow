// input: Optional AnySearch credential, independent of the selected model provider
// output: The primary web search provider; createSearchTool owns DDG fallback
// pos: Capability router for Storyflow's typed web_search tool

import type { WebSearchProvider } from './types.ts';

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
      ?.filter(item => item.type === 'text' && item.text)
      .map(item => item.text)
      .join('\n\n');
    if (!text) {
      throw new Error('AnySearch returned no text results');
    }

    return [{ title: 'AnySearch results', url: '', description: text }];
  }
}

export function resolveSearchProvider(): WebSearchProvider {
  return new AnySearchProvider();
}
