// input: SourceSelectorPopover source
// output: Regression checks for source selection membership in render paths
// pos: Keeps source selector rows from doing nested slug scans per render

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const source = readFileSync(new URL('../SourceSelectorPopover.tsx', import.meta.url), 'utf8')

describe('SourceSelectorPopover render path', () => {
  it('uses a set for selected source membership checks', () => {
    expect(source).toContain('const selectedSlugSet = React.useMemo')
    expect(source).toContain('selectedSlugSet.has(source.config.slug)')
    expect(source).not.toContain('selectedSlugs.includes(source.config.slug)')
  })
})
