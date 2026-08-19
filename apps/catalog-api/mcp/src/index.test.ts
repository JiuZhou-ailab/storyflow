// input: Local MCP client requests and a fake authenticated Catalog origin
// output: Regression coverage for bearer isolation and real MCP tool discovery/calls
// pos: Small end-to-end gate for the public Catalog MCP boundary

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createFetchHandler, loadSettings, type Settings } from './index'

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
      if (url.pathname === '/v2/video-assets') {
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
    mcpAuth: { mode: 'bearer', token: MCP_TOKEN },
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
  it('accepts private-network MCP requests without distributing a bearer credential', async () => {
    const handler = createFetchHandler({
      catalogApiUrl: new URL(`http://127.0.0.1:${catalogServer.port}`),
      catalogOriginToken: ORIGIN_TOKEN,
      mcpAuth: { mode: 'private-network' },
      host: '127.0.0.1',
      port: 8789,
    })
    const response = await handler(new Request('http://catalog.test/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json',
    }))

    expect(response.status).toBe(400)
  })

  it('fails closed unless the deployment declares its authentication mode', () => {
    const base = {
      CATALOG_API_URL: 'http://catalog-api:8788',
      CATALOG_ORIGIN_TOKEN: ORIGIN_TOKEN,
    }

    expect(() => loadSettings(base)).toThrow('MCP_AUTH_MODE is required')
    expect(() => loadSettings({ ...base, MCP_AUTH_MODE: 'bearer' })).toThrow('MCP_BEARER_TOKEN is required')
    expect(loadSettings({ ...base, MCP_AUTH_MODE: 'private-network' }).mcpAuth).toEqual({ mode: 'private-network' })
  })

  it('rejects missing bearer credentials before parsing MCP input', async () => {
    const response = await fetch(`http://127.0.0.1:${mcpServer.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json',
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'invalid_mcp_access_token' })
  })

  it('rejects unauthenticated relay readiness probes before calling the Catalog origin', async () => {
    const requestCount = catalogRequests.length
    const response = await fetch(`http://127.0.0.1:${mcpServer.port}/ready`)

    expect(response.status).toBe(401)
    expect(catalogRequests).toHaveLength(requestCount)
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
        'video_assets',
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

      const assets = await client.callTool({
        name: 'video_assets',
        arguments: { source: 'reelshort-app', seriesId: 'book-1', limit: 10 },
      })
      expect(assets.isError).not.toBe(true)
      const assetContent = assets.content as Array<{ type: string; text?: string }>
      const assetText = assetContent[0]?.type === 'text' ? assetContent[0].text ?? '' : ''
      expect(JSON.parse(assetText)).toMatchObject({
        query: {
          source: 'reelshort-app',
          seriesId: 'book-1',
          limit: '10',
          offset: '0',
        },
      })
    } finally {
      await client.close()
    }
  })
})
