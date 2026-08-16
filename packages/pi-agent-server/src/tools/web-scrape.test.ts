// input: Host-projected loopback broker configuration and a mocked scrape response
// output: Regression coverage for credential-safe managed webpage extraction
// pos: Capability-boundary test for Pi's built-in web_scrape tool

import { describe, expect, it } from 'bun:test';
import { createWebScrapeTool } from './web-scrape.ts';

describe('createWebScrapeTool', () => {
  it('routes only through the host loopback capability broker', async () => {
    const originalFetch = globalThis.fetch;
    const previousUrl = process.env.STORYFLOW_TOOL_BROKER_URL;
    const previousToken = process.env.STORYFLOW_TOOL_BROKER_TOKEN;
    try {
      process.env.STORYFLOW_TOOL_BROKER_URL = 'http://127.0.0.1:43123/v1/tools';
      process.env.STORYFLOW_TOOL_BROKER_TOKEN = 'local-process-capability';
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toBe('http://127.0.0.1:43123/v1/tools/scrape');
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer local-process-capability');
        expect(JSON.parse(String(init?.body))).toEqual({ url: 'https://example.com/article' });
        return Response.json({
          markdown: 'Rendered article',
          title: 'Example',
          url: 'https://example.com/article',
        });
      }) as typeof fetch;

      const result = await createWebScrapeTool().execute('tool-1', {
        url: 'https://example.com/article',
      });
      expect(result.details?.isError).toBeUndefined();
      expect((result.content[0] as { text: string }).text).toContain('Rendered article');
    } finally {
      globalThis.fetch = originalFetch;
      if (previousUrl === undefined) delete process.env.STORYFLOW_TOOL_BROKER_URL;
      else process.env.STORYFLOW_TOOL_BROKER_URL = previousUrl;
      if (previousToken === undefined) delete process.env.STORYFLOW_TOOL_BROKER_TOKEN;
      else process.env.STORYFLOW_TOOL_BROKER_TOKEN = previousToken;
    }
  });
});
