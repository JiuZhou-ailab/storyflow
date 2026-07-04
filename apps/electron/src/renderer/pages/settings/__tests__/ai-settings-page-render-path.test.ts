// input: AiSettingsPage source
// output: Regression checks for settings-page render-path derived values
// pos: Guards workspace override cards from repeated collapsed-summary scans

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../AiSettingsPage.tsx', import.meta.url), 'utf8')

describe('AiSettingsPage render path', () => {
  it('memoizes workspace override summary text instead of recomputing it during render', () => {
    expect(source).toContain('const summary = useMemo(() => {')
    expect(source).toContain(': summary')
    expect(source).not.toContain('const getSummary = () =>')
    expect(source).not.toContain(': getSummary()')
  })
})
