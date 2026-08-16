// input: One public webpage URL plus the host-projected managed scrape broker
// output: Rendered primary-content Markdown from the Storyflow scrape operation
// pos: Provider-neutral built-in web_scrape tool, isolated from other web capabilities

import { Type } from '@sinclair/typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

const TOOL_BROKER_URL_ENV = 'STORYFLOW_TOOL_BROKER_URL';
const TOOL_BROKER_TOKEN_ENV = 'STORYFLOW_TOOL_BROKER_TOKEN';

const schema = Type.Object({
  url: Type.String({ description: 'Public HTTP(S) webpage URL to render and extract' }),
});

interface ManagedScrapeResponse {
  markdown?: string;
  title?: string;
  url?: string;
}

export function createWebScrapeTool(): ToolDefinition<typeof schema> {
  return {
    name: 'web_scrape',
    label: 'Web Scrape',
    description: 'Render one public webpage and return its primary readable content as Markdown.',
    promptSnippet:
      'Use web_scrape when a public webpage must be rendered before extracting its primary readable content. Pass url.',
    parameters: schema,
    async execute(_toolCallId, { url }) {
      try {
        const brokerUrl = resolveLoopbackScrapeUrl(process.env[TOOL_BROKER_URL_ENV]);
        const capability = process.env[TOOL_BROKER_TOKEN_ENV]?.trim();
        if (!brokerUrl || !capability) throw new Error('Managed webpage extraction is unavailable');

        const response = await fetch(brokerUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${capability}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url }),
          signal: AbortSignal.timeout(75_000),
        });
        if (!response.ok) throw new Error(`Managed webpage extraction failed (HTTP ${response.status})`);

        const data = await response.json() as ManagedScrapeResponse;
        if (!data.markdown?.trim() || !data.url?.trim()) {
          throw new Error('Managed webpage extraction returned no content');
        }
        return {
          content: [{
            type: 'text' as const,
            text: `${data.title?.trim() ? `# ${data.title.trim()}\n\n` : ''}${data.markdown.trim()}\n\nSource: ${data.url.trim()}`,
          }],
          details: {},
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: error instanceof Error ? error.message : String(error),
          }],
          details: { isError: true },
        };
      }
    },
  };
}

function resolveLoopbackScrapeUrl(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const url = new URL(raw);
  if (
    url.protocol !== 'http:'
    || url.hostname !== '127.0.0.1'
    || url.username
    || url.password
  ) {
    throw new Error('Managed tool broker must be a credential-free 127.0.0.1 HTTP URL');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/scrape`;
  url.search = '';
  url.hash = '';
  return url.toString();
}
