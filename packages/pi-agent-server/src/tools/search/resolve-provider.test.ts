// input: AnySearch environment configuration and mocked MCP responses
// output: Regression coverage for provider-independent web search routing
// pos: Capability-boundary test preventing model credentials from entering search

import { describe, expect, it } from 'bun:test';
import { AnySearchProvider, resolveSearchProvider } from './resolve-provider.ts';
import { DDGSearchProvider } from './providers/ddg.ts';

describe('resolveSearchProvider', () => {
  it('uses AnySearch only when its own credential is configured', () => {
    const previousKey = process.env.ANYSEARCH_API_KEY;
    try {
      process.env.ANYSEARCH_API_KEY = 'as_test';
      expect(resolveSearchProvider()).toBeInstanceOf(AnySearchProvider);

      delete process.env.ANYSEARCH_API_KEY;
      expect(resolveSearchProvider()).toBeInstanceOf(DDGSearchProvider);
    } finally {
      if (previousKey === undefined) delete process.env.ANYSEARCH_API_KEY;
      else process.env.ANYSEARCH_API_KEY = previousKey;
    }
  });

  it('calls AnySearch without exposing model credentials', async () => {
    const originalFetch = globalThis.fetch;
    const previousKey = process.env.ANYSEARCH_API_KEY;

    try {
      process.env.ANYSEARCH_API_KEY = 'as_test';
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toBe('https://api.anysearch.com/mcp');
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer as_test');
        expect(JSON.parse(String(init?.body))).toMatchObject({
          method: 'tools/call',
          params: { name: 'search', arguments: { query: 'Storyflow', max_results: 3 } },
        });
        return new Response(JSON.stringify({
          result: { content: [{ type: 'text', text: 'Current Storyflow results' }] },
        }), { status: 200 });
      }) as typeof fetch;

      await expect(new AnySearchProvider().search('Storyflow', 3)).resolves.toEqual([{
        title: 'AnySearch results',
        url: '',
        description: 'Current Storyflow results',
      }]);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousKey === undefined) delete process.env.ANYSEARCH_API_KEY;
      else process.env.ANYSEARCH_API_KEY = previousKey;
    }
  });
});
