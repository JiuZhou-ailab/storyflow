// input: Curated seeds and malformed public Skill bundles
// output: Regression checks for deterministic bytes and executable/path rejection
// pos: Worker-side package trust-boundary tests

import { describe, expect, test } from 'bun:test'
import { METHODOLOGY_SEEDS } from './catalog.ts'
import { buildSeedBundle, validateMarketBundle } from './packages.ts'

describe('Skills Market packages', () => {
  test('builds stable installable seed bundles', async () => {
    const seed = METHODOLOGY_SEEDS.find(item => item.slug === 'world-system-map')!
    const first = await buildSeedBundle(seed)
    const second = await buildSeedBundle(seed)
    expect(first.sha256).toBe(second.sha256)
    expect(first.manifest.contributes?.projectLayout?.roots.map(root => root.path)).toEqual(seed.roots)
  })

  test('rejects reference-only downloads', async () => {
    const seed = METHODOLOGY_SEEDS.find(item => item.distribution === 'reference-only')!
    await expect(buildSeedBundle(seed)).rejects.toThrow('reference-only')
  })

  test('rejects scripts before publication', async () => {
    const built = await buildSeedBundle(METHODOLOGY_SEEDS[0]!)
    const bundle = structuredClone(built.bundle)
    bundle.resources.skills![0]!.files.push({ relativePath: 'scripts/run.ts', contentBase64: 'eA==', size: 1 })
    await expect(validateMarketBundle(bundle)).rejects.toThrow('executable or binary')
  })
})
