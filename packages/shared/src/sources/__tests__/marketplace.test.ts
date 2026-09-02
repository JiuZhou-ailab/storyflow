// input: Current official Registry shapes plus hostile or unsupported remote definitions
// output: Regression checks for safe one-click Source mapping and manual-only fallbacks
// pos: Executable boundary between public discovery metadata and local MCP connections

import { describe, expect, test } from 'bun:test'
import {
  getMcpRegistryInstallDecision,
  parseMcpRegistryListResponse,
  type McpRegistryServerResponse,
} from '../marketplace.ts'

function server(remote: Record<string, unknown>, status = 'active'): McpRegistryServerResponse {
  return parseMcpRegistryListResponse({
    servers: [{
      server: {
        name: 'com.example/remote',
        title: 'Example MCP',
        description: 'Example remote',
        version: '1.2.3',
        remotes: [remote],
      },
      _meta: {
        'io.modelcontextprotocol.registry/official': {
          status,
          publishedAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
          isLatest: true,
        },
      },
    }],
    metadata: { count: 1 },
  }).servers[0]!
}

describe('MCP marketplace Source mapping', () => {
  test('maps one active public HTTPS streamable endpoint without credentials', () => {
    expect(getMcpRegistryInstallDecision(server({ type: 'streamable-http', url: 'https://mcp.example.com/mcp' })))
      .toEqual({
        installable: true,
        endpoint: 'https://mcp.example.com/mcp',
        input: {
          name: 'Example MCP',
          provider: 'com.example/remote',
          type: 'mcp',
          enabled: true,
          mcp: { transport: 'http', url: 'https://mcp.example.com/mcp', authType: 'none' },
        },
      })
  })

  test.each([
    [{ type: 'streamable-http', url: 'http://47.91.2.252:9000/mcp' }, 'insecure_http'],
    [{ type: 'streamable-http', url: 'https://127.0.0.1/mcp' }, 'private_host'],
    [{ type: 'streamable-http', url: 'https://100.64.0.1/mcp' }, 'private_host'],
    [{ type: 'streamable-http', url: 'https://[2001:db8::1]/mcp' }, 'private_host'],
    [{ type: 'streamable-http', url: 'https://mcp.example.com/mcp?token=secret' }, 'credentials'],
    [{ type: 'streamable-http', url: 'https://mcp.example.com/{tenant}' }, 'templated'],
    [{ type: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: [{ name: 'Authorization' }] }, 'credentials'],
    [{ type: 'sse', url: 'https://mcp.example.com/sse' }, 'unsupported_transport'],
  ] as const)('keeps unsafe or unsupported remote manual-only', (remote, reason) => {
    expect(getMcpRegistryInstallDecision(server(remote))).toEqual({ installable: false, reason })
  })

  test('rejects inactive entries before considering their endpoint', () => {
    expect(getMcpRegistryInstallDecision(server({ type: 'streamable-http', url: 'https://mcp.example.com/mcp' }, 'deleted')))
      .toEqual({ installable: false, reason: 'inactive' })
  })

  test('does not mistake a public hostname prefix for an IPv6 range', () => {
    expect(getMcpRegistryInstallDecision(server({ type: 'streamable-http', url: 'https://fc.example.com/mcp' })).installable)
      .toBe(true)
  })

  test('tolerates an empty optional repository object without failing the catalog', () => {
    const parsed = parseMcpRegistryListResponse({
      servers: [{
        server: {
          name: 'ai.agentrapay/agentra',
          description: 'Agentra',
          version: '1.0.0',
          repository: {},
          remotes: [{ type: 'streamable-http', url: 'https://mcp.agentra.ai/mcp' }],
        },
        _meta: {
          'io.modelcontextprotocol.registry/official': {
            status: 'active',
            publishedAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
            isLatest: true,
          },
        },
      }],
      metadata: { count: 1 },
    })
    expect(parsed.servers[0]!.server.repository).toBeUndefined()
    expect(getMcpRegistryInstallDecision(parsed.servers[0]!)).toEqual({
      installable: true,
      endpoint: 'https://mcp.agentra.ai/mcp',
      input: {
        name: 'ai.agentrapay/agentra',
        provider: 'ai.agentrapay/agentra',
        type: 'mcp',
        enabled: true,
        mcp: { transport: 'http', url: 'https://mcp.agentra.ai/mcp', authType: 'none' },
      },
    })
  })

  test('keeps a well-formed optional repository when present', () => {
    const parsed = parseMcpRegistryListResponse({
      servers: [{
        server: {
          name: 'com.example/remote',
          description: 'Example',
          version: '1.0.0',
          repository: { url: 'https://github.com/example/remote', source: 'github' },
          remotes: [{ type: 'streamable-http', url: 'https://mcp.example.com/mcp' }],
        },
        _meta: {
          'io.modelcontextprotocol.registry/official': {
            status: 'active',
            publishedAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
            isLatest: true,
          },
        },
      }],
      metadata: { count: 1 },
    })
    expect(parsed.servers[0]!.server.repository).toEqual({ url: 'https://github.com/example/remote', source: 'github' })
  })
})
