// input: Worker requests with no Cloudflare persistence bindings
// output: Public catalog, detail, bundle, API-only routing, and publication-auth regression checks
// pos: Local executable API contract for the Skills Market MVP

import { describe, expect, test } from 'bun:test'
import { handleRequest, type Env } from './index.ts'

const env: Env = {}

describe('Skills Market worker', () => {
  test('lists thirty researched methodologies', async () => {
    const response = await handleRequest(new Request('https://market.test/api/skills'), env)
    const body = await response.json() as {
      total: number
      skills: Array<{ sha256: string, downloadCount: number, featured?: boolean }>
    }
    expect(response.status).toBe(200)
    expect(body.total).toBe(30)
    expect(body.skills.filter(skill => skill.sha256).length).toBe(13)
    expect(body.skills.every(skill => skill.downloadCount === 0)).toBeTrue()
    expect(body.skills.filter(skill => skill.featured).length).toBe(8)
  })

  test('serves deterministic install bundles', async () => {
    const detail = await handleRequest(new Request('https://market.test/api/skills/world-system-map'), env)
    const metadata = await detail.json() as { sha256: string, installUrl: string }
    const bundle = await handleRequest(new Request('https://market.test/api/skills/world-system-map/versions/1.0.0/bundle'), env)
    expect(bundle.headers.get('x-content-sha256')).toBe(metadata.sha256)
    expect(metadata.installUrl).toStartWith('craftagents://action/install-skill?')
  })

  test('answers immutable bundle metadata without a response body', async () => {
    const response = await handleRequest(new Request(
      'https://market.test/api/skills/world-system-map/versions/1.0.0/bundle',
      { method: 'HEAD' },
    ), env)
    expect(response.status).toBe(200)
    expect(response.headers.get('x-content-sha256')).toHaveLength(64)
    expect(await response.text()).toBe('')
  })

  test('keeps reference-only methods inert', async () => {
    const detail = await handleRequest(new Request('https://market.test/api/skills/premise-snowball'), env)
    const metadata = await detail.json() as { sha256: string, installUrl: string }
    expect(metadata.sha256).toBe('')
    expect(metadata.installUrl).toBe('')
  })

  test('serves no standalone web product and requires a publish token', async () => {
    const root = await handleRequest(new Request('https://market.test/'), env)
    const response = await handleRequest(new Request('https://market.test/api/submissions', { method: 'POST', body: '{}' }), env)
    expect(root.status).toBe(404)
    expect(root.headers.get('content-type')).toContain('application/json')
    expect(response.status).toBe(401)
  })
})
