// input: Worker requests with no Cloudflare persistence bindings
// output: Public catalog, detail, bundle, API-only routing, and publication-auth regression checks
// pos: Local executable API contract for the Skills Market MVP

import { describe, expect, test } from 'bun:test'
import { handleRequest, type Env } from './index.ts'
import { CURATED_SKILLS } from './catalog.ts'

const env: Env = {}

describe('Skills Market worker', () => {
  test('does not expose ignored local Skill roots as public sources', () => {
    expect(CURATED_SKILLS.every(skill => !skill.sourceUrl?.includes('.agents/skills'))).toBeTrue()
  })

  test('lists only installable Skills by default and keeps source-only discovery explicit', async () => {
    expect(CURATED_SKILLS.filter(skill => skill.package).every(skill => skill.package?.objectKey)).toBeTrue()
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
    expect(body.total).toBe(9)
    expect(body.skills.every(skill => skill.sha256)).toBeTrue()
    expect(body.skills.every(skill => skill.downloadCount === 0)).toBeTrue()
    expect(body.skills.every(skill => skill.featured)).toBeTrue()
    expect(body.skills.map(skill => skill.recommendation?.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(body.skills.map(skill => skill.slug)).toEqual([
      'sn2s-novel-to-screenplay', 'video-to-screenplay', 'hot-video-script-ideation', 'web-research',
      'tomato-novelist', 'fiction-crafter', 'novel-evaluator', 'novel-to-drama', 'novel-to-storyboard',
    ])

    const installable = await handleRequest(new Request('https://market.test/api/skills?distribution=installable'), env)
    const references = await handleRequest(new Request('https://market.test/api/skills?distribution=reference-only'), env)
    expect((await installable.json() as { total: number }).total).toBe(9)
    expect((await references.json() as { total: number }).total).toBe(5)
  })

  test('serves traceable recommendation detail without fabricating a package', async () => {
    const detail = await handleRequest(new Request('https://market.test/api/skills/find-skills'), env)
    const metadata = await detail.json() as {
      sha256: string
      installUrl: string
      skillMarkdown: string
      recommendation: { label: string, sourceUrl: string }
    }
    expect(metadata.sha256).toBe('')
    expect(metadata.installUrl).toBe('')
    expect(metadata.skillMarkdown).toContain('https://www.skills.sh/vercel-labs/skills/find-skills')
    expect(metadata.recommendation.label).toContain('2.8M')

    const storyflowBundleHead = await handleRequest(new Request(
      'https://market.test/api/skills/video-to-screenplay/versions/1.0.0/bundle',
      { method: 'HEAD' },
    ), env)
    expect(storyflowBundleHead.status).toBe(503)

    const bundle = await handleRequest(new Request(
      'https://market.test/api/skills/find-skills/versions/1.0.0/bundle',
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
