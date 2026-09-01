// input: Storyflow MCP subregistry list requests and main-process network access
// output: Strictly parsed latest-version discovery metadata for the renderer
// pos: Desktop network boundary; listed MCP endpoints are never contacted here

import {
  DEFAULT_MCP_REGISTRY_ORIGIN,
  parseMcpRegistryListResponse,
  type McpRegistryListResponse,
} from '@craft-agent/shared/sources/marketplace'

type RegistryFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export async function listMcpServersFromMarket(
  search: string,
  options: { fetchImpl: RegistryFetch },
): Promise<McpRegistryListResponse> {
  const url = new URL('/v0.1/servers', DEFAULT_MCP_REGISTRY_ORIGIN)
  url.searchParams.set('version', 'latest')
  url.searchParams.set('limit', '60')
  const normalizedSearch = search.trim()
  if (normalizedSearch) url.searchParams.set('search', normalizedSearch.slice(0, 100))
  const response = await options.fetchImpl(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`MCP Registry request failed (${response.status})`)
  return parseMcpRegistryListResponse(await response.json())
}
