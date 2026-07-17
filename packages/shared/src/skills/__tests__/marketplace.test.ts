// input: Marketplace manifests, install links, and mocked registry downloads
// output: Regression checks for safe paths, fixed-origin URLs, and checksum enforcement
// pos: Contract tests for the public Skills supply-chain boundary

import { describe, expect, test } from 'bun:test'
import {
  buildSkillInstallDeepLink,
  downloadMarketSkillBundle,
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
})
