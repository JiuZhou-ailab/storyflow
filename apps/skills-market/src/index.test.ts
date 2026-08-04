// input: Worker requests with no Cloudflare persistence bindings
// output: Public catalog, detail, bundle, API-only routing, and publication-auth regression checks
// pos: Local executable API contract for the Skills Market MVP

import { describe, expect, test } from 'bun:test'
import { handleRequest, type Env } from './index.ts'

const env: Env = {}

describe('Skills Market worker', () => {
  test('lists twenty popular general Skills plus five Storyflow recommendations', async () => {
    const response = await handleRequest(new Request('https://market.test/api/skills'), env)
    const body = await response.json() as {
      total: number
      skills: Array<{
        slug: string
        sha256: string
        downloadCount: number
        featured?: boolean
        recommendation?: { order: number, label: string, sourceUrl: string }
      }>
    }
    expect(response.status).toBe(200)
    expect(body.total).toBe(25)
    expect(body.skills.every(skill => skill.sha256 === '')).toBeTrue()
    expect(body.skills.every(skill => skill.downloadCount === 0)).toBeTrue()
    expect(body.skills.every(skill => skill.featured)).toBeTrue()
    expect(body.skills.map(skill => skill.recommendation?.order)).toEqual(Array.from({ length: 25 }, (_, index) => index + 1))
    expect(body.skills.slice(0, 3).map(skill => skill.slug)).toEqual(['find-skills', 'grill-me', 'frontend-design'])
    const slugs = body.skills.map(skill => skill.slug)
    for (const slug of [
      'skill-creator', 'anysearch', 'sn2s-novel-to-screenplay',
      'video-to-screenplay', 'discover-hit-dramas',
    ]) expect(slugs).toContain(slug)
  })

  test('serves traceable recommendation detail without fabricating a package', async () => {
    const detail = await handleRequest(new Request('https://market.test/api/skills/anysearch'), env)
    const metadata = await detail.json() as {
      sha256: string
      installUrl: string
      skillMarkdown: string
      recommendation: { label: string, sourceUrl: string }
    }
    expect(metadata.sha256).toBe('')
    expect(metadata.installUrl).toBe('')
    expect(metadata.skillMarkdown).toContain('https://github.com/JiuZhou-ailab/storyflow')
    expect(metadata.recommendation.label).toContain('34.4K')

    const bundle = await handleRequest(new Request(
      'https://market.test/api/skills/anysearch/versions/1.0.0/bundle',
    ), env)
    expect(bundle.status).toBe(404)
  })

  test('serves no standalone web product and requires a publish token', async () => {
    const root = await handleRequest(new Request('https://market.test/'), env)
    const response = await handleRequest(new Request('https://market.test/api/submissions', { method: 'POST', body: '{}' }), env)
    expect(root.status).toBe(404)
    expect(root.headers.get('content-type')).toContain('application/json')
    expect(response.status).toBe(401)
  })
})
