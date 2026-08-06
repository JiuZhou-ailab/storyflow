// input: Valid and malformed public Skill bundles plus pinned curated ZIP archives
// output: Regression checks for deterministic validation, executable rejection, and allowlisted conversion
// pos: Worker-side package trust-boundary tests

import { describe, expect, test } from 'bun:test'
import { prepareMarketSkillBundle, sha256Hex } from '@craft-agent/shared/skills/marketplace'
import type { ResourceBundle } from '@craft-agent/shared/resources'
import { strToU8, zipSync } from 'fflate'
import type { CuratedSkill } from './catalog.ts'
import { convertCuratedSkillArchive, readCuratedArchive, validateMarketBundle } from './packages.ts'

function validBundle(): ResourceBundle {
  const content = '---\nname: test-skill\ndescription: Test skill\n---\n\n# Test\n'
  const bytes = new TextEncoder().encode(content)
  return prepareMarketSkillBundle({
    bundle: {
      version: 1,
      exportedAt: 1,
      resources: { skills: [{
        slug: 'test-skill',
        files: [{ relativePath: 'SKILL.md', contentBase64: btoa(content), size: bytes.byteLength }],
      }] },
    },
    publication: {
      version: '1.0.0',
      displayName: 'Test Skill',
      summary: 'Test skill',
      license: 'Apache-2.0',
      visibility: 'public',
    },
  }, { name: 'Test Author' })
}

describe('Skills Market packages', () => {
  test('validates deterministic real Skill bundles', async () => {
    const bundle = validBundle()
    const first = await validateMarketBundle(bundle)
    const second = await validateMarketBundle(bundle)
    expect(first.sha256).toBe(second.sha256)
    expect(first.manifest.slug).toBe('test-skill')
  })

  test('rejects scripts before publication', async () => {
    const bundle = validBundle()
    bundle.resources.skills![0]!.files.push({ relativePath: 'scripts/run.ts', contentBase64: 'eA==', size: 1 })
    await expect(validateMarketBundle(bundle)).rejects.toThrow('executable or binary')
  })

  test('converts only a digest-pinned curated archive and preserves its text scripts', async () => {
    const archive = zipSync({
      '.learnings/STATE.md': strToU8('# State\n'),
      'SKILL.md': strToU8('---\nname: curated-test\ndescription: Curated test\n---\n\n# Curated\n'),
      'LICENSE': strToU8('MIT\n'),
      'bun.lock': strToU8('lockfileVersion = 1\n'),
      'scripts/check.py': strToU8('print("ok")\n'),
    })
    const seed: CuratedSkill = {
      slug: 'curated-test',
      displayName: 'Curated Test',
      summary: 'Curated test',
      tags: ['test'],
      sourceName: '@source/curated-test',
      sourceUrl: 'https://example.com/curated-test',
      license: 'MIT',
      recommendation: {
        order: 1,
        label: 'Pinned test',
        sourceName: 'Example',
        sourceUrl: 'https://example.com',
        snapshotAt: '2026-08-06',
      },
      package: {
        namespace: 'source',
        sourceSlug: 'curated-test',
        version: '1.0.0',
        publishedAt: 1,
        archiveSha256: await sha256Hex(archive),
        bundleSha256: '',
      },
    }

    const converted = await convertCuratedSkillArchive(seed, archive)
    expect(converted.manifest.slug).toBe('curated-test')
    expect(converted.files.get('.learnings/STATE.md')).toBe('# State\n')
    expect(converted.files.get('scripts/check.py')).toBe('print("ok")\n')
    expect(converted.files.get('LICENSE')).toBe('MIT\n')
    await expect(convertCuratedSkillArchive(seed, new Uint8Array([1]))).rejects.toThrow('checksum')

    const compressedOversizedFile = zipSync({
      'SKILL.md': strToU8('---\nname: curated-test\ndescription: Curated test\n---\n\n# Curated\n'),
      'large.txt': new Uint8Array(512 * 1024 + 1),
    })
    seed.package!.archiveSha256 = await sha256Hex(compressedOversizedFile)
    await expect(convertCuratedSkillArchive(seed, compressedOversizedFile)).rejects.toThrow('file exceeds')
  })

  test('stops reading a chunked curated archive above the package limit', async () => {
    const chunk = new Uint8Array(3 * 1024 * 1024)
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(chunk)
        controller.enqueue(chunk)
        controller.close()
      },
    }))

    await expect(readCuratedArchive(response)).rejects.toThrow('exceeds 5 MB')
  })
})
