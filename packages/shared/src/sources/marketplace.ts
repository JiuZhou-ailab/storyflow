// input: Untrusted Storyflow MCP subregistry responses and user-selected server entries
// output: Browser-safe catalog types plus a fail-closed mapping to local Source creation
// pos: Shared trust boundary between MCP discovery metadata and Storyflow-owned Source configuration

import type { CreateSourceInput } from './types.ts'

export const DEFAULT_MCP_REGISTRY_ORIGIN = 'https://storyflow-mcp.zjding.com'
const OFFICIAL_META_KEY = 'io.modelcontextprotocol.registry/official'

export type McpRegistryStatus = 'active' | 'deprecated' | 'deleted'

export interface McpRegistryRemote {
  type: string
  url: string
  headers?: unknown[]
  variables?: Record<string, unknown>
}

export interface McpRegistryServer {
  name: string
  version: string
  description: string
  title?: string
  websiteUrl?: string
  repository?: { url: string, source: string }
  remotes?: McpRegistryRemote[]
  packages?: unknown[]
}

export interface McpRegistryServerResponse {
  server: McpRegistryServer
  _meta: Record<string, unknown> & {
    'io.modelcontextprotocol.registry/official': {
      status: McpRegistryStatus
      publishedAt: string
      updatedAt: string
      isLatest: boolean
    }
  }
}

export interface McpRegistryListResponse {
  servers: McpRegistryServerResponse[]
  metadata: { count: number, nextCursor?: string }
}

export type McpRegistryInstallDecision =
  | { installable: true, endpoint: string, input: CreateSourceInput }
  | { installable: false, reason: 'inactive' | 'no_remote' | 'unsupported_transport' | 'insecure_http' | 'templated' | 'credentials' | 'private_host' | 'invalid_url' }

export function parseMcpRegistryListResponse(value: unknown): McpRegistryListResponse {
  const response = asRecord(value, 'MCP Registry catalog')
  const metadata = asRecord(response.metadata, 'MCP Registry catalog metadata')
  if (!Array.isArray(response.servers) || !Number.isSafeInteger(metadata.count) || (metadata.count as number) < 0) {
    throw new Error('MCP Registry returned an invalid catalog')
  }
  if (metadata.nextCursor !== undefined && typeof metadata.nextCursor !== 'string') {
    throw new Error('MCP Registry returned an invalid cursor')
  }
  return {
    servers: response.servers.map(parseMcpRegistryServerResponse),
    metadata: {
      count: metadata.count as number,
      ...(typeof metadata.nextCursor === 'string' ? { nextCursor: metadata.nextCursor } : {}),
    },
  }
}

export function parseMcpRegistryServerResponse(value: unknown): McpRegistryServerResponse {
  const response = asRecord(value, 'MCP Registry response')
  const server = asRecord(response.server, 'MCP Registry server')
  const metadata = asRecord(response._meta, 'MCP Registry metadata')
  const official = asRecord(metadata[OFFICIAL_META_KEY], 'Official MCP Registry metadata')
  if (!['name', 'version', 'description'].every(key => typeof server[key] === 'string' && Boolean((server[key] as string).trim()))) {
    throw new Error('MCP Registry returned an invalid server identity')
  }
  if (!['active', 'deprecated', 'deleted'].includes(String(official.status))
    || typeof official.isLatest !== 'boolean'
    || !['publishedAt', 'updatedAt'].every(key => typeof official[key] === 'string' && Number.isFinite(Date.parse(official[key] as string)))) {
    throw new Error('MCP Registry returned invalid lifecycle metadata')
  }
  if (server.title !== undefined && typeof server.title !== 'string') throw new Error('MCP Registry returned an invalid title')
  if (server.websiteUrl !== undefined && !isHttpUrl(server.websiteUrl)) throw new Error('MCP Registry returned an invalid website URL')
  if (server.repository !== undefined) {
    const repository = asRecord(server.repository, 'MCP Registry repository')
    if (!isHttpUrl(repository.url) || typeof repository.source !== 'string') {
      throw new Error('MCP Registry returned an invalid repository')
    }
  }
  if (server.packages !== undefined && !Array.isArray(server.packages)) throw new Error('MCP Registry returned invalid packages')
  const remotes = server.remotes === undefined ? undefined : parseRemotes(server.remotes)
  return {
    server: {
      name: server.name as string,
      version: server.version as string,
      description: server.description as string,
      ...(typeof server.title === 'string' ? { title: server.title } : {}),
      ...(typeof server.websiteUrl === 'string' ? { websiteUrl: server.websiteUrl } : {}),
      ...(server.repository ? { repository: server.repository as McpRegistryServer['repository'] } : {}),
      ...(remotes ? { remotes } : {}),
      ...(Array.isArray(server.packages) ? { packages: server.packages } : {}),
    },
    _meta: response._meta as McpRegistryServerResponse['_meta'],
  }
}

export function getMcpRegistryInstallDecision(response: McpRegistryServerResponse): McpRegistryInstallDecision {
  const official = response._meta[OFFICIAL_META_KEY]
  if (official.status !== 'active') return { installable: false, reason: 'inactive' }
  const remotes = response.server.remotes ?? []
  if (remotes.length === 0) return { installable: false, reason: 'no_remote' }
  const remote = remotes.find(candidate => candidate.type === 'streamable-http')
  if (!remote) return { installable: false, reason: 'unsupported_transport' }
  if (remote.headers?.length || (remote.variables && Object.keys(remote.variables).length > 0)) {
    return { installable: false, reason: 'credentials' }
  }
  if (/[{}]/.test(remote.url)) return { installable: false, reason: 'templated' }
  let endpoint: URL
  try {
    endpoint = new URL(remote.url)
  } catch {
    return { installable: false, reason: 'invalid_url' }
  }
  if (endpoint.protocol !== 'https:') return { installable: false, reason: 'insecure_http' }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    return { installable: false, reason: 'credentials' }
  }
  if (isPrivateHostname(endpoint.hostname)) return { installable: false, reason: 'private_host' }
  const url = endpoint.toString()
  return {
    installable: true,
    endpoint: url,
    input: {
      name: response.server.title ?? response.server.name,
      provider: response.server.name,
      type: 'mcp',
      enabled: true,
      mcp: { transport: 'http', url, authType: 'none' },
    },
  }
}

export function getMcpRegistryExternalUrl(server: McpRegistryServer): string | null {
  return normalizeHttpUrl(server.websiteUrl) ?? normalizeHttpUrl(server.repository?.url)
}

function parseRemotes(value: unknown): McpRegistryRemote[] {
  if (!Array.isArray(value)) throw new Error('MCP Registry returned invalid remotes')
  return value.map(item => {
    const remote = asRecord(item, 'MCP Registry remote')
    if (typeof remote.type !== 'string' || typeof remote.url !== 'string') {
      throw new Error('MCP Registry returned an invalid remote')
    }
    if (remote.headers !== undefined && !Array.isArray(remote.headers)) throw new Error('MCP Registry returned invalid remote headers')
    if (remote.variables !== undefined && (!remote.variables || typeof remote.variables !== 'object' || Array.isArray(remote.variables))) {
      throw new Error('MCP Registry returned invalid remote variables')
    }
    return {
      type: remote.type,
      url: remote.url,
      ...(Array.isArray(remote.headers) ? { headers: remote.headers } : {}),
      ...(remote.variables ? { variables: remote.variables as Record<string, unknown> } : {}),
    }
  })
}

function isHttpUrl(value: unknown): value is string {
  return normalizeHttpUrl(value) !== null
}

function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLocaleLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) return true
  if (normalized.includes(':')) return true
  const octets = normalized.split('.').map(Number)
  if (octets.length !== 4 || octets.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return !normalized.includes('.')
  }
  const first = octets[0]!
  const second = octets[1]!
  const third = octets[2]!
  return first === 0 || first === 10 || first === 127 || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && (third === 0 || third === 2))
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100)))
    || (first === 203 && second === 0 && third === 113)
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}
