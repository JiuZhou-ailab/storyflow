// input: Valid and malformed public Skill bundles
// output: Regression checks for deterministic validation and executable/path rejection
// pos: Worker-side package trust-boundary tests

import { describe, expect, test } from 'bun:test'
import { prepareMarketSkillBundle } from '@craft-agent/shared/skills/marketplace'
import type { ResourceBundle } from '@craft-agent/shared/resources'
import { validateMarketBundle } from './packages.ts'

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
})
