// input: Host-projected loopback tool broker configuration
// output: Storyflow's primary managed web-search provider; createSearchTool owns DDG fallback
// pos: Provider-neutral client of the host-owned Managed Tool Operation

import type { WebSearchProvider, WebSearchResult } from './types.ts'

const TOOL_BROKER_URL_ENV = 'STORYFLOW_TOOL_BROKER_URL'
const TOOL_BROKER_TOKEN_ENV = 'STORYFLOW_TOOL_BROKER_TOKEN'

interface ManagedSearchResponse {
  results?: WebSearchResult[]
}

export class ManagedSearchProvider implements WebSearchProvider {
  name = 'Storyflow'

  async search(query: string, count: number): Promise<WebSearchResult[]> {
    const brokerUrl = resolveLoopbackSearchUrl(process.env[TOOL_BROKER_URL_ENV])
    const capability = process.env[TOOL_BROKER_TOKEN_ENV]?.trim()
    if (!brokerUrl || !capability) {
      throw new Error('Managed web search is unavailable')
    }

    const response = await fetch(brokerUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${capability}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, count }),
      signal: AbortSignal.timeout(40_000),
    })
    if (!response.ok) {
      throw new Error(`Managed web search failed (HTTP ${response.status})`)
    }

    const data = await response.json() as ManagedSearchResponse
    if (!Array.isArray(data.results) || data.results.length === 0) {
      throw new Error('Managed web search returned no results')
    }
    return data.results
  }
}

export function resolveSearchProvider(): WebSearchProvider {
  return new ManagedSearchProvider()
}

function resolveLoopbackSearchUrl(raw: string | undefined): string | null {
  if (!raw?.trim()) return null
  const url = new URL(raw)
  if (
    url.protocol !== 'http:'
    || url.hostname !== '127.0.0.1'
    || url.username
    || url.password
  ) {
    throw new Error('Managed tool broker must be a credential-free 127.0.0.1 HTTP URL')
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/search`
  url.search = ''
  url.hash = ''
  return url.toString()
}
