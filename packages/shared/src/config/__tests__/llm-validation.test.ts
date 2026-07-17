// input: Mock Anthropic Messages API responses and connection credentials
// output: Regression coverage for direct protocol validation without an agent SDK
// pos: Connection-boundary tests for Anthropic-compatible providers

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { validateAnthropicConnection } from '../llm-validation.ts';

describe('validateAnthropicConnection', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('validates API keys against the Anthropic Messages endpoint', async () => {
    const fetchMock = mock(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => (
      new Response('{}', { status: 200 })
    ));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await validateAnthropicConnection({
      model: 'claude-sonnet-4-6',
      apiKey: 'test-api-key',
    });

    expect(result).toEqual({ success: true });
    const [endpoint, request] = fetchMock.mock.calls[0]!;
    expect(endpoint).toBe('https://api.anthropic.com/v1/messages');
    expect(request?.headers).toMatchObject({
      'anthropic-version': '2023-06-01',
      'x-api-key': 'test-api-key',
    });
    expect(request?.headers).not.toHaveProperty('authorization');
  });

  test('uses bearer and OAuth compatibility headers for Anthropic OAuth', async () => {
    const fetchMock = mock(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => (
      new Response('{}', { status: 200 })
    ));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await validateAnthropicConnection({
      model: 'claude-sonnet-4-6',
      oauthToken: 'test-oauth-token',
      baseUrl: 'https://example.test/v1/',
    });

    expect(result).toEqual({ success: true });
    const [endpoint, request] = fetchMock.mock.calls[0]!;
    expect(endpoint).toBe('https://example.test/v1/messages');
    expect(request?.headers).toMatchObject({
      authorization: 'Bearer test-oauth-token',
      'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
      'x-app': 'cli',
    });
    expect(request?.headers).not.toHaveProperty('x-api-key');
  });

  test('maps protocol errors to a user-facing validation result', async () => {
    globalThis.fetch = mock(async () => new Response(
      JSON.stringify({ error: { message: 'invalid x-api-key' } }),
      { status: 401 },
    )) as unknown as typeof fetch;

    expect(await validateAnthropicConnection({
      model: 'claude-sonnet-4-6',
      apiKey: 'bad-key',
    })).toEqual({
      success: false,
      error: 'Authentication failed. Check your API key or OAuth token.',
    });
  });
});
