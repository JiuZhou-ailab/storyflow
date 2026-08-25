// input: Marketplace manifests, install links, and mocked registry downloads
// output: Regression checks for safe paths, fixed-origin URLs, and checksum enforcement
// pos: Contract tests for the public Skills supply-chain boundary

import { describe, expect, test } from 'bun:test'
import {
  buildSkillInstallDeepLink,
  downloadMarketSkillBundle,
  parseMarketSkillDetail,
  prepareMarketSkillBundle,
  sha256Hex,
  validateStoryflowSkillManifest,
} from '../marketplace.ts'

const manifest = {
  schemaVersion: 1,
  slug: 'scene-sequel',
  version: '1.0.0',
  displayName: 'Scene and Sequel',
  summary: 'Alternate goal-driven scenes with reflective sequels.',
  license: 'CC-BY-4.0',
  author: { name: 'Storyflow' },
  contributes: { projectLayout: { roots: [{ path: 'scenes', create: true }] } },
}

describe('Skills Market contract', () => {
  test('accepts declarative project roots and rejects traversal', () => {
    expect(validateStoryflowSkillManifest(manifest)).toEqual([])
    expect(validateStoryflowSkillManifest({
      ...manifest,
      contributes: { projectLayout: { roots: [{ path: '../outside' }] } },
    })).toContain('roots[0].path must be a safe project-relative path')
  })

  test('builds an inert deep link without an arbitrary download URL', () => {
    const url = buildSkillInstallDeepLink({ slug: 'scene-sequel', version: '1.0.0', sha256: 'a'.repeat(64) })
    expect(url).toContain('craftagents://action/install-skill?')
    expect(url).not.toContain('registry=')
    expect(url).not.toContain('url=')
  })

  test('parses matching marketplace detail and rejects mismatched content', () => {
    const detail = {
      slug: manifest.slug,
      version: manifest.version,
      displayName: manifest.displayName,
      summary: manifest.summary,
      author: manifest.author.name,
      publisher: { id: 'user_1', displayName: '发布者' },
      visibility: 'public',
      license: manifest.license,
      tags: ['故事'],
      roots: ['scenes'],
      downloadCount: 12,
      recommendation: {
        order: 1,
        label: '2.8M installs on skills.sh',
        sourceName: 'skills.sh',
        sourceUrl: 'https://www.skills.sh/',
        snapshotAt: '2026-08-04',
      },
      sha256: 'a'.repeat(64),
      skillMarkdown: '---\nname: scene-sequel\ndescription: Scene workflow\n---\n\n# Instructions',
      manifest,
      downloadPath: '/api/skills/scene-sequel/versions/1.0.0/bundle',
      installUrl: 'craftagents://action/install-skill',
    }
    expect(parseMarketSkillDetail(detail)).toMatchObject({
      downloadCount: 12,
      recommendation: { order: 1, sourceName: 'skills.sh' },
    })
    expect(() => parseMarketSkillDetail({
      ...detail,
      manifest: { ...manifest, slug: 'other-skill' },
    })).toThrow('mismatched')
    expect(() => parseMarketSkillDetail({
      ...detail,
      recommendation: { ...detail.recommendation, sourceUrl: 'file:///tmp/skills' },
    })).toThrow('invalid Skill')
  })

  test('verifies registry bytes before returning a bundle', async () => {
    const raw = JSON.stringify({
      version: 1,
      exportedAt: 1,
      resources: { skills: [{ slug: 'scene-sequel', files: [] }] },
    })
    const sha256 = await sha256Hex(raw)
    const downloaded = await downloadMarketSkillBundle(
      { slug: 'scene-sequel', version: '1.0.0', sha256 },
      { fetchImpl: async () => new Response(raw) },
    )
    expect(downloaded.sha256).toBe(sha256)
    await expect(downloadMarketSkillBundle(
      { slug: 'scene-sequel', version: '1.0.0', sha256: 'b'.repeat(64) },
      { fetchImpl: async () => new Response(raw) },
    )).rejects.toThrow('checksum')
  })

  test('stops reading an oversized registry response before buffering it', async () => {
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1)

    await expect(downloadMarketSkillBundle(
      { slug: 'scene-sequel', version: '1.0.0', sha256: 'a'.repeat(64) },
      { fetchImpl: async () => new Response(oversized) },
    )).rejects.toThrow('exceeds 5 MB')
  })

  test('adds publication metadata without conflating content attribution and publisher identity', () => {
    const skillMarkdown = '---\nname: 剧情因果审查\ndescription: 审查故事因果\n---\n\n正文\n'
    const bytes = new TextEncoder().encode(skillMarkdown)
    const bundle = prepareMarketSkillBundle({
      bundle: {
        version: 1,
        exportedAt: 1,
        resources: { skills: [{
          slug: 'plot-causality-audit',
          files: [
            {
              relativePath: 'SKILL.md',
              contentBase64: Buffer.from(bytes).toString('base64'),
              size: bytes.byteLength,
            },
            {
              relativePath: 'storyflow.json',
              contentBase64: Buffer.from(JSON.stringify({ author: { name: '内容作者' } })).toString('base64'),
              size: Buffer.byteLength(JSON.stringify({ author: { name: '内容作者' } })),
            },
          ],
        }] },
      },
      publication: {
        version: '1.0.0',
        displayName: '剧情因果审查',
        summary: '审查故事因果链',
        license: 'CC-BY-4.0',
        tags: ['写作', '写作'],
        visibility: 'public',
      },
    }, { name: '上传者' })

    const packagedSkill = bundle.resources.skills?.[0]
    const manifestFile = packagedSkill?.files.find(file => file.relativePath === 'storyflow.json')
    expect(packagedSkill?.slug).toBe('plot-causality-audit')
    expect(manifestFile).toBeDefined()
    expect(JSON.parse(Buffer.from(manifestFile!.contentBase64, 'base64').toString('utf8'))).toMatchObject({
      slug: 'plot-causality-audit',
      author: { name: '内容作者' },
      tags: ['写作'],
    })
  })
})
