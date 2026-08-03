// input: Exported Skill, publication metadata, mocked Market response, and ephemeral token
// output: Regression proof for main-only authenticated publication shaping
// pos: Small executable check for the desktop-to-Market trust boundary

import { describe, expect, it } from 'bun:test'
import { publishSkillToMarket } from '../skills-market-client'

describe('Skills Market client', () => {
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
      },
    }, {
      author: { name: 'Author' },
      token: 'ephemeral-market-token',
      fetchImpl: async (url, init) => {
        expect(url.toString()).toBe('https://storyflow-skills.zjding.com/api/submissions')
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
