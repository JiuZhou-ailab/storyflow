// input: Loopback broker requests, local capabilities, and mocked cloud capability services
// output: Regression coverage for zero-config model and tool access without cloud credential exposure
// pos: Guards the desktop boundary exposed to trusted local Agent and CLI processes

import { afterEach, describe, expect, it } from 'bun:test'
import {
  MODEL_ACCESS_BROKER_TOKEN_ENV,
  MODEL_ACCESS_BROKER_URL_ENV,
  TOOL_BROKER_TOKEN_ENV,
  TOOL_BROKER_URL_ENV,
  startManagedCapabilityBroker,
  type ManagedCapabilityBroker,
} from '../managed-capability-broker'

let broker: ManagedCapabilityBroker | null = null

afterEach(async () => {
  await broker?.close()
  broker = null
})

describe('managed capability broker', () => {
  it('returns model access but proxies tool access without exposing its cloud token', async () => {
    const toolForceValues: boolean[] = []
    const toolGatewayRequests: Request[] = []
    broker = await startManagedCapabilityBroker({
      modelGatewayBaseUrl: 'https://storyflow-model.zjding.com/v1',
      toolGatewayBaseUrl: 'https://storyflow-tools.zjding.com/v1',
      isAuthenticated: () => true,
      ensureModelAccessToken: async ({ force } = {}) => ({
        token: force ? 'refreshed-model-token' : 'fresh-model-token',
      }),
      ensureToolAccessToken: async ({ force } = {}) => {
        toolForceValues.push(force === true)
        return { token: force ? 'refreshed-tool-token' : 'fresh-tool-token' }
      },
      fetchImpl: async (request) => {
        toolGatewayRequests.push(request)
        if (request.headers.get('authorization') === 'Bearer fresh-tool-token') {
          return Response.json({ code: 'tool_access_token_invalid' }, { status: 401 })
        }
        return Response.json({
          results: [{ title: 'Web search results', url: '', description: 'Current results' }],
        })
      },
    })

    const modelResponse = await fetch(broker.env[MODEL_ACCESS_BROKER_URL_ENV], {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${broker.env[MODEL_ACCESS_BROKER_TOKEN_ENV]}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ forceRefresh: true }),
    })
    const toolResponse = await fetch(`${broker.env[TOOL_BROKER_URL_ENV]}/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${broker.env[TOOL_BROKER_TOKEN_ENV]}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'Storyflow', count: 3 }),
    })

    expect(await modelResponse.json()).toEqual({
      gatewayBaseUrl: 'https://storyflow-model.zjding.com',
      modelAccessToken: 'refreshed-model-token',
    })
    expect(toolResponse.status).toBe(200)
    expect(await toolResponse.json()).toEqual({
      results: [{ title: 'Web search results', url: '', description: 'Current results' }],
    })
    expect(toolForceValues).toEqual([false, true])
    expect(toolGatewayRequests.at(-1)?.url).toBe('https://storyflow-tools.zjding.com/v1/search')
    expect(toolGatewayRequests.at(-1)?.headers.get('authorization')).toBe('Bearer refreshed-tool-token')
    expect(JSON.stringify(broker.env)).not.toContain('fresh-tool-token')
    expect(JSON.stringify(broker.env)).not.toContain('refreshed-tool-token')
  })

  it('fails closed for invalid local capability and signed-out users', async () => {
    let authenticated = true
    broker = await startManagedCapabilityBroker({
      modelGatewayBaseUrl: 'https://storyflow-model.zjding.com',
      toolGatewayBaseUrl: 'https://storyflow-tools.zjding.com',
      isAuthenticated: () => authenticated,
      ensureModelAccessToken: async () => ({ token: 'must-not-leak' }),
      ensureToolAccessToken: async () => ({ token: 'must-not-leak' }),
    })

    const invalid = await fetch(`${broker.env[TOOL_BROKER_URL_ENV]}/search`, {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-capability' },
    })
    authenticated = false
    const signedOut = await fetch(broker.env[MODEL_ACCESS_BROKER_URL_ENV], {
      method: 'POST',
      headers: { Authorization: `Bearer ${broker.env[MODEL_ACCESS_BROKER_TOKEN_ENV]}` },
    })

    expect(invalid.status).toBe(403)
    expect(await invalid.json()).toMatchObject({ code: 'local_capability_invalid' })
    expect(signedOut.status).toBe(401)
    expect(await signedOut.json()).toMatchObject({ code: 'storyflow_login_required' })
  })

  it('proxies the exact managed scrape operation without exposing the cloud token', async () => {
    const upstreamRequests: Request[] = []
    broker = await startManagedCapabilityBroker({
      modelGatewayBaseUrl: 'https://storyflow-model.zjding.com',
      toolGatewayBaseUrl: 'https://storyflow-tools.zjding.com',
      isAuthenticated: () => true,
      ensureModelAccessToken: async () => ({ token: 'model-token' }),
      ensureToolAccessToken: async () => ({ token: 'cloud-tool-token' }),
      fetchImpl: async (request) => {
        upstreamRequests.push(request)
        return Response.json({
          markdown: 'Rendered article',
          title: 'Example',
          url: 'https://example.com/article',
        })
      },
    })

    const response = await fetch(`${broker.env[TOOL_BROKER_URL_ENV]}/scrape`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${broker.env[TOOL_BROKER_TOKEN_ENV]}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: 'https://example.com/article' }),
    })

    expect(response.status).toBe(200)
    expect(upstreamRequests.at(-1)?.url).toBe('https://storyflow-tools.zjding.com/v1/scrape')
    expect(upstreamRequests.at(-1)?.headers.get('authorization')).toBe('Bearer cloud-tool-token')
    expect(JSON.stringify(broker.env)).not.toContain('cloud-tool-token')
  })

  it('rejects oversized tool responses without buffering them into the child process', async () => {
    broker = await startManagedCapabilityBroker({
      modelGatewayBaseUrl: 'https://storyflow-model.zjding.com',
      toolGatewayBaseUrl: 'https://storyflow-tools.zjding.com',
      isAuthenticated: () => true,
      ensureModelAccessToken: async () => ({ token: 'model-token' }),
      ensureToolAccessToken: async () => ({ token: 'tool-token' }),
      fetchImpl: async () => new Response(new Uint8Array(1024 * 1024 + 1)),
    })

    const response = await fetch(`${broker.env[TOOL_BROKER_URL_ENV]}/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${broker.env[TOOL_BROKER_TOKEN_ENV]}` },
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'Tool response exceeds 1MB' })
  })
})
