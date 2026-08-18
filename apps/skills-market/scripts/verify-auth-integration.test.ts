// input: Skills Market auth canary with deterministic fake service responses
// output: Regression proof for broker capability forwarding and fail-closed inputs
// pos: Small executable contract for the cross-service deployment canary

import { describe, expect, it } from 'bun:test'
import { decodeJwt, decodeProtectedHeader } from 'jose'
import { verifySkillsMarketAuth } from './verify-auth-integration'

describe('verifySkillsMarketAuth', () => {
  it('uses a bounded client session and forwards the broker capability to Market', async () => {
    const requests: Request[] = []
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request)
      if (request.url.includes('/api/client-auth/skills-market/token')) {
        return Response.json({ marketPublishToken: 'market-capability' })
      }
      return Response.json({ skills: [{ slug: 'storyflow-test' }] })
    }

    const result = await verifySkillsMarketAuth({
      clientSessionSecret: 'client-session-secret',
      fetchImpl: fetchImpl as typeof fetch,
      nowSeconds: 1_800_000_000,
    })

    const appToken = requests[0]?.headers.get('authorization')?.replace('Bearer ', '') ?? ''
    expect(decodeProtectedHeader(appToken).kid).toBe('client-session-2026-07')
    expect(decodeJwt(appToken)).toMatchObject({
      aud: 'storyflow-client-auth',
      exp: 1_800_000_300,
      scope: 'capability:issue',
    })
    expect(requests[1]?.headers.get('authorization')).toBe('Bearer market-capability')
    expect(result).toEqual({ catalog: 1 })
  })

  it('fails before network access when the client-session secret is missing', async () => {
    let called = false
    await expect(verifySkillsMarketAuth({
      clientSessionSecret: '',
      fetchImpl: (async () => {
        called = true
        return Response.json({})
      }) as typeof fetch,
    })).rejects.toThrow('STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET is required')
    expect(called).toBe(false)
  })
})
