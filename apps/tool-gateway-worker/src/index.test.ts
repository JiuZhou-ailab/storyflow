// input: Tool Gateway requests, signed test capabilities, and mocked provider responses
// output: Regression coverage for authorization, input bounds, and provider credential isolation
// pos: Security check for independent managed tool operations

import { describe, expect, it, spyOn } from 'bun:test'
import { exportSPKI, generateKeyPair, SignJWT } from 'jose'
import { handleRequest, type ToolGatewayEnv } from './index'

const TOOL_KEY_ID = 'tool-access-2026-08'
const toolKeyPair = await generateKeyPair('ES256', { extractable: true })
const TOOL_PUBLIC_KEY = await exportSPKI(toolKeyPair.publicKey)

function makeEnv(overrides: Partial<ToolGatewayEnv> = {}): ToolGatewayEnv {
  return {
    STORYFLOW_TOOL_GATEWAY_JWT_CURRENT_KEY_ID: TOOL_KEY_ID,
    STORYFLOW_TOOL_GATEWAY_JWT_CURRENT_PUBLIC_KEY: TOOL_PUBLIC_KEY,
    STORYFLOW_TOOL_GATEWAY_JWT_AUDIENCE: 'storyflow-tool-gateway',
    STORYFLOW_TOOL_GATEWAY_JWT_ISSUER: 'storyflow-auth-broker',
    ANYSEARCH_UPSTREAM_URL: 'https://api.anysearch.com/mcp',
    ANYSEARCH_API_KEY: 'server-only-anysearch-key',
    FIRECRAWL_UPSTREAM_URL: 'https://api.firecrawl.dev/v2/scrape',
    FIRECRAWL_API_KEY: 'server-only-firecrawl-key',
    SEARCH_RATE_LIMITER: { limit: async () => ({ success: true }) },
    SCRAPE_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ...overrides,
  }
}

async function signToolToken(scopes = ['web:search']): Promise<string> {
  return new SignJWT({ scopes })
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: TOOL_KEY_ID })
    .setIssuer('storyflow-auth-broker')
    .setAudience('storyflow-tool-gateway')
    .setSubject('neon:user-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(toolKeyPair.privateKey)
}

describe('tool gateway worker', () => {
  it('fails readiness and authorization closed', async () => {
    const missingKey = await handleRequest(
      new Request('https://tools.storyflow.example.com/ready'),
      makeEnv({ STORYFLOW_TOOL_GATEWAY_JWT_CURRENT_PUBLIC_KEY: undefined }),
    )
    const missingToken = await handleRequest(
      new Request('https://tools.storyflow.example.com/v1/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'Storyflow' }),
      }),
      makeEnv(),
    )
    const missingScrapeProvider = await handleRequest(
      new Request('https://tools.storyflow.example.com/ready'),
      makeEnv({ FIRECRAWL_API_KEY: undefined }),
    )
    const wrongScope = await handleRequest(
      new Request('https://tools.storyflow.example.com/v1/search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await signToolToken(['model:chat'])}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: 'Storyflow' }),
      }),
      makeEnv(),
    )
    const rateLimited = await handleRequest(
      new Request('https://tools.storyflow.example.com/v1/search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await signToolToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: 'Storyflow' }),
      }),
      makeEnv({ SEARCH_RATE_LIMITER: { limit: async () => ({ success: false }) } }),
    )

    expect(missingKey.status).toBe(503)
    expect(missingScrapeProvider.status).toBe(503)
    expect(missingToken.status).toBe(401)
    expect(await missingToken.json()).toMatchObject({ code: 'tool_access_token_invalid' })
    expect(wrongScope.status).toBe(403)
    expect(rateLimited.status).toBe(429)
    expect(rateLimited.headers.get('retry-after')).toBe('60')
  })

  it('keeps search and scrape authorization independent', async () => {
    const headers = { 'Content-Type': 'application/json' }
    const searchOnlyScrape = await handleRequest(
      new Request('https://tools.storyflow.example.com/v1/scrape', {
        method: 'POST',
        headers: {
          ...headers,
          Authorization: `Bearer ${await signToolToken(['web:search'])}`,
        },
        body: JSON.stringify({ url: 'https://example.com/article' }),
      }),
      makeEnv(),
    )
    const scrapeOnlySearch = await handleRequest(
      new Request('https://tools.storyflow.example.com/v1/search', {
        method: 'POST',
        headers: {
          ...headers,
          Authorization: `Bearer ${await signToolToken(['web:scrape'])}`,
        },
        body: JSON.stringify({ query: 'Storyflow' }),
      }),
      makeEnv(),
    )

    expect(searchOnlyScrape.status).toBe(403)
    expect(scrapeOnlySearch.status).toBe(403)
  })

  it('injects the AnySearch key and logs no query or credential', async () => {
    const log = spyOn(console, 'log').mockImplementation(() => {})
    let upstreamRequest: Request | null = null
    try {
      const response = await handleRequest(
        new Request('https://tools.storyflow.example.com/v1/search', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await signToolToken()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: 'private search query', count: 3 }),
        }),
        makeEnv(),
        async (request) => {
          upstreamRequest = request
          return Response.json({
            result: { content: [{ type: 'text', text: 'Current results' }] },
          })
        },
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        results: [{ title: 'Web search results', url: '', description: 'Current results' }],
      })
      expect(upstreamRequest?.headers.get('authorization')).toBe('Bearer server-only-anysearch-key')
      expect(await upstreamRequest?.json()).toMatchObject({
        method: 'tools/call',
        params: { name: 'search', arguments: { query: 'private search query', max_results: 3 } },
      })
      const logs = log.mock.calls.flat().join(' ')
      expect(logs).not.toContain('private search query')
      expect(logs).not.toContain('server-only-anysearch-key')
      expect(logs).toContain('web:search')
    } finally {
      log.mockRestore()
    }
  })

  it('bounds requests and hides upstream authentication failures', async () => {
    const token = await signToolToken()
    const tooLarge = await handleRequest(
      new Request('https://tools.storyflow.example.com/v1/search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: 'x'.repeat(17 * 1024) }),
      }),
      makeEnv(),
    )
    const upstreamAuthFailure = await handleRequest(
      new Request('https://tools.storyflow.example.com/v1/search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: 'Storyflow' }),
      }),
      makeEnv(),
      async () => Response.json({ provider: 'secret detail' }, { status: 401 }),
    )
    const oversizedUpstream = await handleRequest(
      new Request('https://tools.storyflow.example.com/v1/search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: 'Storyflow' }),
      }),
      makeEnv(),
      async () => new Response(new Uint8Array(1024 * 1024 + 1)),
    )

    expect(tooLarge.status).toBe(413)
    expect(upstreamAuthFailure.status).toBe(502)
    expect(await upstreamAuthFailure.json()).toEqual({
      error: 'Search provider authentication failed',
      code: 'upstream_auth_failed',
    })
    expect(oversizedUpstream.status).toBe(502)
    expect(await oversizedUpstream.json()).toEqual({
      error: 'Search provider returned an invalid response',
    })
  })

  it('injects the Firecrawl key only for validated public webpage extraction', async () => {
    let upstreamRequest: Request | null = null
    let upstreamCalls = 0
    const token = await signToolToken(['web:scrape'])
    const scrape = await handleRequest(
      new Request('https://tools.storyflow.example.com/v1/scrape', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: 'https://example.com/article' }),
      }),
      makeEnv(),
      async (request) => {
        upstreamCalls += 1
        upstreamRequest = request
        return Response.json({
          success: true,
          data: {
            markdown: 'Rendered article',
            metadata: { title: 'Example', sourceURL: 'https://example.com/article' },
          },
        })
      },
    )
    const privateUrl = await handleRequest(
      new Request('https://tools.storyflow.example.com/v1/scrape', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: 'http://127.0.0.1/admin' }),
      }),
      makeEnv(),
      async () => {
        upstreamCalls += 1
        return Response.json({ success: true })
      },
    )
    const mappedPrivateUrl = await handleRequest(
      new Request('https://tools.storyflow.example.com/v1/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url: 'http://[::ffff:7f00:1]/admin' }),
      }),
      makeEnv(),
      async () => {
        upstreamCalls += 1
        return Response.json({ success: true })
      },
    )

    expect(scrape.status).toBe(200)
    expect(await scrape.json()).toEqual({
      markdown: 'Rendered article',
      title: 'Example',
      url: 'https://example.com/article',
    })
    expect(upstreamRequest?.url).toBe('https://api.firecrawl.dev/v2/scrape')
    expect(upstreamRequest?.headers.get('authorization')).toBe('Bearer server-only-firecrawl-key')
    expect(await upstreamRequest?.json()).toEqual({
      url: 'https://example.com/article',
      formats: ['markdown'],
      onlyMainContent: true,
      timeout: 60_000,
    })
    expect(privateUrl.status).toBe(400)
    expect(mappedPrivateUrl.status).toBe(400)
    expect(upstreamCalls).toBe(1)
  })
})
