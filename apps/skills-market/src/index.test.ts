// input: Worker requests with no Cloudflare persistence bindings
// output: Public catalog, detail, bundle, API-only routing, and publication-auth regression checks
// pos: Local executable API contract for the Skills Market MVP

import { describe, expect, test } from 'bun:test'
import { handleRequest, type Env } from './index.ts'

const env: Env = {}

describe('Skills Market worker', () => {
  test('lists a focused mix of Storyflow, writing, and general recommendations', async () => {
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
    expect(body.total).toBe(15)
    expect(body.skills.every(skill => skill.sha256 === '')).toBeTrue()
    expect(body.skills.every(skill => skill.downloadCount === 0)).toBeTrue()
    expect(body.skills.every(skill => skill.featured)).toBeTrue()
    expect(body.skills.map(skill => skill.recommendation?.order)).toEqual(Array.from({ length: 15 }, (_, index) => index + 1))
    expect(body.skills.map(skill => skill.slug)).toEqual([
      'sn2s-novel-to-screenplay', 'video-to-screenplay', 'discover-hit-dramas',
      'hot-video-script-ideation', 'anysearch', 'g113593', 'fiction-crafter',
      'novel-evaluator', 'novel-to-drama', 'novel-to-storyboard', 'find-skills',
      'grill-me', 'research', 'brainstorming', 'skill-creator',
    ])
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

    const privateProjectDetail = await handleRequest(new Request('https://market.test/api/skills/video-to-screenplay'), env)
    const privateProjectMetadata = await privateProjectDetail.json() as {
      skillMarkdown: string
      manifest: { author: { url?: string } }
    }
    expect(privateProjectMetadata.skillMarkdown).not.toContain('/.agents/skills/video-to-screenplay')
    expect(privateProjectMetadata.manifest.author.url).toBeUndefined()

    const skillHubDetail = await handleRequest(new Request('https://market.test/api/skills/novel-to-drama'), env)
    const skillHubMetadata = await skillHubDetail.json() as {
      skillMarkdown: string
      recommendation: { label: string, sourceUrl: string }
    }
    expect(skillHubMetadata.skillMarkdown).toContain('https://skillhub.cn/skills/user_f0835403/novel-to-drama')
    expect(skillHubMetadata.recommendation.label).toContain('2.6 千')
    expect(skillHubMetadata.recommendation.sourceUrl).toBe('https://skillhub.cn/')

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
