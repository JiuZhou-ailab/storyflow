/**
 * input: API source configuration and the in-process MCP pool client
 * output: Regression coverage for framework-neutral API source tool discovery and execution
 * pos: Verifies API Sources use the official MCP SDK without a Claude Agent SDK wrapper
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { ApiSourcePoolClient } from '../../mcp/api-source-pool-client.ts';
import { createApiServer } from '../api-tools.ts';
import type { ApiConfig } from '../types.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('API source MCP server', () => {
  test('exposes and executes its API tool through the shared MCP pool', async () => {
    const config: ApiConfig = {
      name: 'example',
      baseUrl: 'https://api.example.com',
      auth: { type: 'none' },
    };
    const serverConfig = createApiServer(config, '');
    const client = new ApiSourcePoolClient(serverConfig.instance);

    globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.example.com/health');
      expect(init?.method).toBe('GET');
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }, { preconnect: originalFetch.preconnect });

    try {
      const tools = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(['api_example']);

      const result = await client.callTool('api_example', {
        path: '/health',
        method: 'GET',
      }) as { content: Array<{ type: string; text?: string }> };

      expect(result.content[0]).toEqual({ type: 'text', text: '{"ok":true}' });
    } finally {
      await client.close();
    }
  });
});
