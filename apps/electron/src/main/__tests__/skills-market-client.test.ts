// input: Exported Skill, publication metadata, mocked Market response, and ephemeral token
// output: Regression proof for main-only authenticated publication shaping
// pos: Small executable check for the desktop-to-Market trust boundary

import { describe, expect, it, spyOn } from 'bun:test'
import { sha256Hex } from '@craft-agent/shared/skills/marketplace'
import {
  createSkillsMarketCatalogLoader,
  downloadSkillFromMarket,
  getSkillDetailFromMarket,
  listSkillsFromMarket,
  publishSkillToMarket,
} from '../skills-market-client'

describe('Skills Market client', () => {
  it('coalesces catalog reads, expires them, and discards invalidated or failed requests', async () => {
    const clock = spyOn(Date, 'now').mockReturnValue(1_000)
    let calls = 0
    let fail = false
    const response = { total: 0, skills: [] }
    const catalog = createSkillsMarketCatalogLoader(async () => {
      calls++
      if (fail) throw new Error('offline')
      return response
    })
    try {
      const first = catalog.load()
      expect(catalog.load()).toBe(first)
      await first
      await catalog.load()
      expect(calls).toBe(1)
      clock.mockReturnValue(31_000)
      await catalog.load()
      expect(calls).toBe(2)
      catalog.invalidate()
      const stale = catalog.load()
      catalog.invalidate()
      const fresh = catalog.load()
      await expect(stale).rejects.toThrow('catalog changed')
      await expect(fresh).resolves.toBe(response)
      expect(catalog.load()).toBe(fresh)
      catalog.invalidate()
      fail = true
      await expect(catalog.load()).rejects.toThrow('offline')
      fail = false
      await expect(catalog.load()).resolves.toBe(response)
      expect(calls).toBe(6)
    } finally {
      clock.mockRestore()
    }
  })

  it('keeps authenticated catalog and bundle reads inside the main process', async () => {
    const raw = JSON.stringify({
      version: 1,
      exportedAt: 1,
      resources: { skills: [{ slug: 'internal-writing', files: [] }] },
    })
    const sha256 = await sha256Hex(raw)
    const calls: string[] = []
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push(url.toString())
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer market-access-token')
      if (url.toString().endsWith('/api/skills')) {
        return Response.json({
          total: 1,
          skills: [{
            slug: 'internal-writing',
            version: '1.0.0',
            displayName: '内部写作',
            summary: '公司写作流程',
            author: '内容团队',
            publisher: { id: 'user_1', displayName: '张三' },
            visibility: 'company',
            license: 'Proprietary',
            tags: ['写作'],
            roots: [],
            downloadCount: 23,
            sha256,
          }],
        })
      }
      if (url.toString().endsWith('/api/skills/internal-writing')) {
        return Response.json({
          slug: 'internal-writing',
          version: '1.0.0',
          displayName: '内部写作',
          summary: '公司写作流程',
          author: '内容团队',
          publisher: { id: 'user_1', displayName: '张三' },
          visibility: 'company',
          license: 'Proprietary',
          tags: ['写作'],
          roots: [],
          downloadCount: 23,
          sha256,
          skillMarkdown: '---\nname: internal-writing\ndescription: 公司写作流程\n---\n\n写作说明',
          manifest: {
            schemaVersion: 1,
            slug: 'internal-writing',
            version: '1.0.0',
            displayName: '内部写作',
            summary: '公司写作流程',
            license: 'Proprietary',
            author: { name: '内容团队' },
          },
          downloadPath: '/api/skills/internal-writing/versions/1.0.0/bundle',
          installUrl: 'craftagents://action/install-skill',
        })
      }
      return new Response(raw)
    }

    const catalog = await listSkillsFromMarket({ token: 'market-access-token', fetchImpl })
    const detail = await getSkillDetailFromMarket('internal-writing', { token: 'market-access-token', fetchImpl })
    const downloaded = await downloadSkillFromMarket(
      { slug: 'internal-writing', version: '1.0.0', sha256 },
      { token: 'market-access-token', fetchImpl },
    )

    expect(catalog.skills[0]?.publisher.displayName).toBe('张三')
    expect(catalog.skills[0]?.downloadCount).toBe(23)
    expect(detail.skillMarkdown).toContain('写作说明')
    expect(downloaded.bundle.resources.skills?.[0]?.slug).toBe('internal-writing')
    expect(calls).toEqual([
      'https://storyflow-skills.zjding.com/api/skills',
      'https://storyflow-skills.zjding.com/api/skills/internal-writing',
      'https://storyflow-skills.zjding.com/api/skills/internal-writing/versions/1.0.0/bundle',
    ])
  })

  it('rejects detail bytes for a different Skill slug', async () => {
    const fetchImpl = async () => Response.json({
      slug: 'different-skill',
      version: '1.0.0',
      displayName: 'Different Skill',
      summary: 'Wrong detail',
      author: 'Publisher',
      publisher: { id: 'publisher', displayName: 'Publisher' },
      visibility: 'public',
      license: 'MIT',
      tags: [],
      roots: [],
      downloadCount: 0,
      sha256: 'a'.repeat(64),
      skillMarkdown: '# Different Skill',
      manifest: {
        schemaVersion: 1,
        slug: 'different-skill',
        version: '1.0.0',
        displayName: 'Different Skill',
        summary: 'Wrong detail',
        license: 'MIT',
        author: { name: 'Publisher' },
      },
      downloadPath: '/api/skills/different-skill/versions/1.0.0/bundle',
      installUrl: 'craftagents://action/install-skill',
    })

    await expect(getSkillDetailFromMarket('requested-skill', { token: 'token', fetchImpl }))
      .rejects.toThrow('mismatched Skill detail')
  })

  it('rejects publication receipts for another package or an invalid digest', async () => {
    const bytes = Buffer.from('---\nname: qa-skill\ndescription: QA\n---\nInstructions')
    for (const receipt of [
      { slug: 'wrong-skill', version: '1.0.0', sha256: 'a'.repeat(64) },
      { slug: 'qa-skill', version: '2.0.0', sha256: 'a'.repeat(64) },
      { slug: 'qa-skill', version: '1.0.0', sha256: 'invalid' },
    ]) {
      await expect(publishSkillToMarket({
        bundle: { version: 1, exportedAt: 1, resources: { skills: [{ slug: 'qa-skill', files: [
          { relativePath: 'SKILL.md', contentBase64: bytes.toString('base64'), size: bytes.byteLength },
        ] }] } },
        publication: { version: '1.0.0', displayName: 'QA', summary: 'QA instructions', license: 'MIT', visibility: 'public' },
      }, { author: { name: 'QA' }, token: 'test-token', fetchImpl: async () => Response.json({ status: 'published', ...receipt }) }))
        .rejects.toThrow('invalid publication result')
    }
  })

  it('adds publisher metadata and sends the capability only to the fixed Market', async () => {
    const skillText = '---\nname: 剧情因果审查\ndescription: 审查故事因果\n---\n\n正文\n'
    const bytes = Buffer.from(skillText)
    const result = await publishSkillToMarket({
      bundle: {
        version: 1,
        exportedAt: 1,
        resources: { skills: [{
          slug: 'plot-causality-audit',
          files: [{ relativePath: 'SKILL.md', contentBase64: bytes.toString('base64'), size: bytes.byteLength }],
        }] },
      },
      publication: {
        version: '1.0.0',
        displayName: '剧情因果审查',
        summary: '审查故事因果链',
        license: 'CC-BY-4.0',
        visibility: 'company',
      },
    }, {
      author: { name: 'Author' },
      token: 'ephemeral-market-token',
      fetchImpl: async (url, init) => {
        expect(url.toString()).toBe('https://storyflow-skills.zjding.com/api/submissions?visibility=company')
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer ephemeral-market-token')
        const bundle = JSON.parse(init?.body as string)
        const manifestFile = bundle.resources.skills[0].files.find((file: { relativePath: string }) => file.relativePath === 'storyflow.json')
        const manifest = JSON.parse(Buffer.from(manifestFile.contentBase64, 'base64').toString('utf8'))
        expect(manifest).toMatchObject({ slug: 'plot-causality-audit', author: { name: 'Author' } })
        return Response.json({
          status: 'published',
          slug: manifest.slug,
          version: manifest.version,
          sha256: 'a'.repeat(64),
        }, { status: 201 })
      },
    })

    expect(result.status).toBe('published')
  })
})
