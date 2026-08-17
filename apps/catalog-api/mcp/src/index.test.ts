// input: Local MCP client requests and a fake authenticated Catalog origin
// output: Regression coverage for bearer isolation and real MCP tool discovery/calls
// pos: Small end-to-end gate for the public Catalog MCP boundary

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createFetchHandler, type Settings } from './index'

const ORIGIN_TOKEN = 'origin-token-that-is-at-least-32-chars'
const MCP_TOKEN = 'mcp-token-that-is-at-least-32-characters'
let catalogServer: ReturnType<typeof Bun.serve>
let mcpServer: ReturnType<typeof Bun.serve>
const catalogRequests: Request[] = []

beforeAll(() => {
  catalogServer = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      catalogRequests.push(request)
      if (request.headers.get('x-storyflow-origin-token') !== ORIGIN_TOKEN) {
        return Response.json({ error: 'unauthorized' }, { status: 401 })
      }
      const url = new URL(request.url)
      if (url.pathname === '/ready') return Response.json({ status: 'ready' })
      if (url.pathname === '/v2/catalog/sources') {
        return Response.json({ version: 2, sources: [{ id: 'hongguo' }] })
      }
      if (url.pathname === '/v2/rankings') {
        return Response.json({
          version: 2,
          status: 'ok',
          query: Object.fromEntries(url.searchParams),
        })
      }
      return Response.json({ error: 'not_found' }, { status: 404 })
    },
  })
  const settings: Settings = {
    catalogApiUrl: new URL(`http://127.0.0.1:${catalogServer.port}`),
    catalogOriginToken: ORIGIN_TOKEN,
    mcpBearerToken: MCP_TOKEN,
    host: '127.0.0.1',
    port: 8789,
  }
  mcpServer = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: createFetchHandler(settings),
  })
})

afterAll(() => {
  mcpServer.stop(true)
  catalogServer.stop(true)
})

describe('Catalog MCP', () => {
  it('rejects missing bearer credentials before parsing MCP input', async () => {
    const response = await fetch(`http://127.0.0.1:${mcpServer.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json',
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'invalid_mcp_access_token' })
  })

  it('lists and calls only fixed tools through the authenticated Catalog boundary', async () => {
    const client = new Client({ name: 'catalog-mcp-test', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${mcpServer.port}/mcp`),
      { requestInit: { headers: { Authorization: `Bearer ${MCP_TOKEN}` } } },
    )
    await client.connect(transport)
    try {
      const tools = await client.listTools()
      expect(tools.tools.map(tool => tool.name)).toEqual([
        'catalog_sources',
        'ranking_snapshots',
        'rankings',
        'series_manifest',
      ])

      const result = await client.callTool({
        name: 'rankings',
        arguments: { source: 'hongguo', query: '青云', limit: 5 },
      })
      expect(result.isError).not.toBe(true)
      const content = result.content as Array<{ type: string; text?: string }>
      const text = content[0]?.type === 'text' ? content[0].text ?? '' : ''
      expect(JSON.parse(text)).toMatchObject({
        version: 2,
        status: 'ok',
        query: {
          source: 'hongguo',
          snapshot: 'latest',
          q: '青云',
          limit: '5',
          conversionReady: 'any',
        },
      })
      expect(catalogRequests.at(-1)?.headers.get('authorization')).toBeNull()
      expect(catalogRequests.at(-1)?.headers.get('x-storyflow-origin-token')).toBe(ORIGIN_TOKEN)
    } finally {
      await client.close()
    }
  })
})
