// input: Mock Storyflow MCP subregistry HTTP responses
// output: Regression checks for fixed-origin latest discovery and response validation
// pos: Main-process MCP catalog network boundary test

import { describe, expect, test } from 'bun:test'
import { listMcpServersFromMarket } from '../mcp-market-client.ts'

describe('MCP market client', () => {
  test('queries only the fixed subregistry and parses current server metadata', async () => {
    let requested = ''
    const result = await listMcpServersFromMarket('weather', {
      fetchImpl: async input => {
        requested = input.toString()
        return Response.json({
          servers: [{
            server: {
              name: 'com.example/weather', version: '1.0.0', description: 'Weather',
              remotes: [{ type: 'streamable-http', url: 'https://weather.example.com/mcp' }],
            },
            _meta: { 'io.modelcontextprotocol.registry/official': {
              status: 'active', publishedAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z', isLatest: true,
            } },
          }],
          metadata: { count: 1 },
        })
      },
    })
    const url = new URL(requested)
    expect(url.origin).toBe('https://storyflow-mcp.zjding.com')
    expect(url.searchParams.get('version')).toBe('latest')
    expect(url.searchParams.get('search')).toBe('weather')
    expect(result.servers[0]?.server.name).toBe('com.example/weather')
  })

  test('rejects malformed responses', async () => {
    await expect(listMcpServersFromMarket('', {
      fetchImpl: async () => Response.json({ servers: [], metadata: {} }),
    })).rejects.toThrow('invalid catalog')
  })
})
