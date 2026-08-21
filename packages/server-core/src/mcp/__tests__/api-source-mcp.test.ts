// input: API source configuration and the in-process MCP pool client
// output: Regression coverage for framework-neutral API source tool discovery and execution
// pos: Verifies API Sources use the official MCP SDK without a Claude Agent SDK wrapper

import { afterEach, describe, expect, test } from 'bun:test';
import { ApiSourcePoolClient } from '../api-source-pool-client';
import { createApiServer } from '@craft-agent/shared/sources';
import type { ApiConfig } from '@craft-agent/shared/sources/types';

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
      expect(tools[0]?.inputSchema.properties).not.toHaveProperty('_intent');

      const result = await client.callTool('api_example', {
        path: '/health',
        method: 'GET',
      }) as { content: Array<{ type: string; text?: string }> };

      expect(result.content[0]).toEqual({ type: 'text', text: '{"ok":true}' });
    } finally {
      await client.close();
    }
  });

  test('exposes declarative operations as bounded typed tools', async () => {
    const config: ApiConfig = {
      name: 'catalog',
      baseUrl: 'https://catalog.example.com',
      auth: { type: 'bearer' },
      operations: [
        {
          name: 'list_sources',
          description: 'List evidence sources.',
          method: 'GET',
          path: '/v2/catalog/sources',
        },
        {
          name: 'search_rankings',
          description: 'Search one source-scoped ranking snapshot.',
          method: 'GET',
          path: '/v2/rankings',
          parameters: [
            { name: 'source', type: 'string', required: true, enum: ['reelshort', 'hongguo'] },
            { name: 'limit', type: 'integer', default: 20, minimum: 1, maximum: 100 },
          ],
        },
        {
          name: 'get_manifest',
          description: 'Get one conversion manifest.',
          method: 'GET',
          path: '/v2/series/{source}/{sourceId}/manifest',
          parameters: [
            { name: 'source', type: 'string', required: true },
            { name: 'sourceId', type: 'string', required: true },
          ],
        },
      ],
    };
    const serverConfig = createApiServer(config, async () => 'managed-token');
    const client = new ApiSourcePoolClient(serverConfig.instance);
    const calls: Array<{ url: string; authorization?: string }> = [];

    globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({ url: String(input), authorization: headers?.Authorization });
      return Response.json({ ok: true });
    }, { preconnect: originalFetch.preconnect });

    try {
      const tools = await client.listTools();
      expect(tools.map(tool => tool.name)).toEqual(['list_sources', 'search_rankings', 'get_manifest']);
      expect(tools[1]?.inputSchema.required).toEqual(['source']);
      expect(serverConfig.toolPermissions).toEqual({
        list_sources: { method: 'GET', path: '/v2/catalog/sources' },
        search_rankings: {
          method: 'GET',
          path: '/v2/rankings',
          parameters: config.operations?.[1]?.parameters,
        },
        get_manifest: {
          method: 'GET',
          path: '/v2/series/{source}/{sourceId}/manifest',
          parameters: config.operations?.[2]?.parameters,
        },
      });

      await client.callTool('list_sources', {});
      await client.callTool('search_rankings', { source: 'reelshort' });
      await client.callTool('get_manifest', { source: 'reelshort', sourceId: 'book/42' });

      expect(calls).toEqual([
        {
          url: 'https://catalog.example.com/v2/catalog/sources',
          authorization: 'Bearer managed-token',
        },
        {
          url: 'https://catalog.example.com/v2/rankings?source=reelshort&limit=20',
          authorization: 'Bearer managed-token',
        },
        {
          url: 'https://catalog.example.com/v2/series/reelshort/book%2F42/manifest',
          authorization: 'Bearer managed-token',
        },
      ]);
    } finally {
      await client.close();
    }
  });
});
