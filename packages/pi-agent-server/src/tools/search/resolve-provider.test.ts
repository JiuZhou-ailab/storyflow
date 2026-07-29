// input: LLM authentication shapes, custom-endpoint mode, and mocked AnySearch responses
// output: Regression coverage for safe search-provider routing and AnySearch transport
// pos: Contract tests preventing model credentials from crossing provider boundaries

import { describe, expect, it } from 'bun:test';
import { AnySearchProvider, resolveSearchProvider } from './resolve-provider.ts';
import { ResponsesApiSearchProvider } from './providers/openai.ts';
import { ChatGPTBackendSearchProvider } from './providers/chatgpt.ts';
import { GoogleSearchProvider } from './providers/google.ts';
import { DDGSearchProvider } from './providers/ddg.ts';

/** Build a minimal JWT with a chatgpt_account_id claim. */
function makeJwt(accountId: string): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(
    JSON.stringify({
      'https://api.openai.com/auth': { chatgpt_account_id: accountId },
    }),
  );
  return `${header}.${payload}.fakesig`;
}

describe('resolveSearchProvider', () => {
  // --- OpenAI (API key) ---

  it('selects ResponsesApiSearchProvider for openai + api_key', () => {
    const provider = resolveSearchProvider({
      provider: 'openai',
      credential: { type: 'api_key', key: 'sk-test' },
    });

    expect(provider).toBeInstanceOf(ResponsesApiSearchProvider);
    expect(provider.name).toBe('OpenAI');
  });

  // --- ChatGPT Plus (OAuth) ---

  it('selects ChatGPTBackendSearchProvider for openai-codex + oauth with valid JWT', () => {
    const provider = resolveSearchProvider({
      provider: 'openai-codex',
      credential: {
        type: 'oauth',
        access: makeJwt('acc_123'),
        refresh: 'r',
        expires: Date.now() + 60_000,
      },
    });

    expect(provider).toBeInstanceOf(ChatGPTBackendSearchProvider);
    expect(provider.name).toBe('ChatGPT');
  });

  it('selects ChatGPTBackendSearchProvider for openai-codex + api_key with valid JWT token', () => {
    const provider = resolveSearchProvider({
      provider: 'openai-codex',
      credential: { type: 'api_key', key: makeJwt('acc_999') },
    });

    expect(provider).toBeInstanceOf(ChatGPTBackendSearchProvider);
    expect(provider.name).toBe('ChatGPT');
  });

  it('falls back to DDG for openai-codex + oauth with malformed JWT', () => {
    const provider = resolveSearchProvider({
      provider: 'openai-codex',
      credential: {
        type: 'oauth',
        access: 'not-a-jwt',
        refresh: 'r',
        expires: Date.now() + 60_000,
      },
    });

    expect(provider).toBeInstanceOf(DDGSearchProvider);
  });

  it('falls back to DDG for openai-codex + api_key with malformed non-JWT token', () => {
    const provider = resolveSearchProvider({
      provider: 'openai-codex',
      credential: { type: 'api_key', key: 'not-a-jwt' },
    });

    expect(provider).toBeInstanceOf(DDGSearchProvider);
  });

  // --- OpenRouter ---

  it('selects ResponsesApiSearchProvider for openrouter + api_key', () => {
    const provider = resolveSearchProvider({
      provider: 'openrouter',
      credential: { type: 'api_key', key: 'sk-or-test' },
    });

    expect(provider).toBeInstanceOf(ResponsesApiSearchProvider);
    expect(provider.name).toBe('OpenRouter');
  });

  // --- Google ---

  it('selects Google provider for google + api_key', () => {
    const provider = resolveSearchProvider({
      provider: 'google',
      credential: { type: 'api_key', key: 'g-test' },
    });

    expect(provider).toBeInstanceOf(GoogleSearchProvider);
  });

  // --- Fallback cases ---

  it('routes custom endpoints to AnySearch without reusing model credentials', () => {
    const provider = resolveSearchProvider({
      provider: 'openai',
      credential: { type: 'api_key', key: 'custom-endpoint-secret' },
    }, true);

    expect(provider).toBeInstanceOf(AnySearchProvider);
    expect(provider.name).toBe('AnySearch');
  });

  it('calls AnySearch through its typed provider', async () => {
    const originalFetch = globalThis.fetch;
    const previousKey = process.env.ANYSEARCH_API_KEY;

    try {
      process.env.ANYSEARCH_API_KEY = 'as_test';
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toBe('https://api.anysearch.com/mcp');
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer as_test');
        expect(JSON.parse(String(init?.body))).toMatchObject({
          method: 'tools/call',
          params: {
            name: 'search',
            arguments: { query: 'Storyflow', max_results: 3 },
          },
        });

        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [{ type: 'text', text: 'Current Storyflow results' }],
          },
        }), { status: 200 });
      }) as typeof fetch;

      const results = await new AnySearchProvider().search('Storyflow', 3);

      expect(results).toEqual([{
        title: 'AnySearch results',
        url: '',
        description: 'Current Storyflow results',
      }]);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousKey === undefined) {
        delete process.env.ANYSEARCH_API_KEY;
      } else {
        process.env.ANYSEARCH_API_KEY = previousKey;
      }
    }
  });

  it('falls back to DDG for openai + oauth (no ChatGPT backend for plain openai)', () => {
    const provider = resolveSearchProvider({
      provider: 'openai',
      credential: {
        type: 'oauth',
        access: 'a',
        refresh: 'r',
        expires: Date.now() + 60_000,
      },
    });

    expect(provider).toBeInstanceOf(DDGSearchProvider);
  });

  it('falls back to DDG when provider is unknown', () => {
    const provider = resolveSearchProvider({
      provider: 'unknown',
      credential: { type: 'api_key', key: 'x' },
    });

    expect(provider).toBeInstanceOf(DDGSearchProvider);
  });

  it('falls back to DDG when key is empty', () => {
    const provider = resolveSearchProvider({
      provider: 'openai',
      credential: { type: 'api_key', key: '' },
    });

    expect(provider).toBeInstanceOf(DDGSearchProvider);
  });

  it('falls back to DDG when no piAuth is provided', () => {
    expect(resolveSearchProvider()).toBeInstanceOf(DDGSearchProvider);
    expect(resolveSearchProvider(undefined)).toBeInstanceOf(DDGSearchProvider);
  });

  it('falls back to DDG for github-copilot (no search API available)', () => {
    const provider = resolveSearchProvider({
      provider: 'github-copilot',
      credential: {
        type: 'oauth',
        access: 'ghu_token',
        refresh: 'r',
        expires: Date.now() + 60_000,
      },
    });

    expect(provider).toBeInstanceOf(DDGSearchProvider);
  });

  it('falls back to DDG for vercel-ai-gateway (not yet wired for provider-native search)', () => {
    const provider = resolveSearchProvider({
      provider: 'vercel-ai-gateway',
      credential: { type: 'api_key', key: 'vercel-test-key' },
    });

    expect(provider).toBeInstanceOf(DDGSearchProvider);
  });
});
