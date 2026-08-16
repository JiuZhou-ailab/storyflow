// input: Host-projected loopback broker configuration and mocked managed search responses
// output: Regression coverage for provider-neutral web search without provider or cloud credentials
// pos: Capability-boundary test for Pi's built-in web_search provider

import { describe, expect, it } from 'bun:test'
import { ManagedSearchProvider, resolveSearchProvider } from './resolve-provider.ts'

describe('resolveSearchProvider', () => {
  it('routes managed search only through the host loopback capability broker', async () => {
    const originalFetch = globalThis.fetch
    const previousUrl = process.env.STORYFLOW_TOOL_BROKER_URL
    const previousToken = process.env.STORYFLOW_TOOL_BROKER_TOKEN
    try {
      process.env.STORYFLOW_TOOL_BROKER_URL = 'http://127.0.0.1:43123/v1/tools'
      process.env.STORYFLOW_TOOL_BROKER_TOKEN = 'local-process-capability'
      expect(resolveSearchProvider()).toBeInstanceOf(ManagedSearchProvider)

      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toBe('http://127.0.0.1:43123/v1/tools/search')
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer local-process-capability')
        expect(JSON.parse(String(init?.body))).toEqual({ query: 'Storyflow', count: 3 })
        return Response.json({
          results: [{ title: 'Web search results', url: '', description: 'Current results' }],
        })
      }) as typeof fetch

      await expect(new ManagedSearchProvider().search('Storyflow', 3)).resolves.toEqual([{
        title: 'Web search results',
        url: '',
        description: 'Current results',
      }])
    } finally {
      globalThis.fetch = originalFetch
      if (previousUrl === undefined) delete process.env.STORYFLOW_TOOL_BROKER_URL
      else process.env.STORYFLOW_TOOL_BROKER_URL = previousUrl
      if (previousToken === undefined) delete process.env.STORYFLOW_TOOL_BROKER_TOKEN
      else process.env.STORYFLOW_TOOL_BROKER_TOKEN = previousToken
    }
  })

  it('rejects non-loopback brokers before sending the local capability', async () => {
    const previousUrl = process.env.STORYFLOW_TOOL_BROKER_URL
    const previousToken = process.env.STORYFLOW_TOOL_BROKER_TOKEN
    try {
      process.env.STORYFLOW_TOOL_BROKER_URL = 'https://attacker.example.com/v1/tools'
      process.env.STORYFLOW_TOOL_BROKER_TOKEN = 'must-not-leak'
      await expect(new ManagedSearchProvider().search('Storyflow', 3)).rejects.toThrow('127.0.0.1')
    } finally {
      if (previousUrl === undefined) delete process.env.STORYFLOW_TOOL_BROKER_URL
      else process.env.STORYFLOW_TOOL_BROKER_URL = previousUrl
      if (previousToken === undefined) delete process.env.STORYFLOW_TOOL_BROKER_TOKEN
      else process.env.STORYFLOW_TOOL_BROKER_TOKEN = previousToken
    }
  })
})
