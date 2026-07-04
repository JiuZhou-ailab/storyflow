// input: WorkspaceSettingsPage source
// output: Regression checks for settings-page source membership in render paths
// pos: Keeps workspace settings source toggles from doing nested list scans per render

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const source = readFileSync(new URL('../WorkspaceSettingsPage.tsx', import.meta.url), 'utf8')

describe('WorkspaceSettingsPage render path', () => {
  it('uses a set for default source checkbox membership checks', () => {
    expect(source).toContain('const enabledSourceSlugSet = React.useMemo')
    expect(source).toContain('enabledSourceSlugSet.has(source.config.slug)')
    expect(source).not.toContain('checked={enabledSourceSlugs.includes(source.config.slug)}')
  })
})
