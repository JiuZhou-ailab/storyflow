// input: AppearanceSettingsPage source
// output: Regression checks for settings-page option derivation in render paths
// pos: Guards appearance selectors from rebuilding static options on every render

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../AppearanceSettingsPage.tsx', import.meta.url), 'utf8')

describe('AppearanceSettingsPage render path', () => {
  it('memoizes static appearance options instead of rebuilding them during render', () => {
    expect(source).toContain('const modeOptions = useMemo<')
    expect(source).toContain('const fontOptions = useMemo<')
    expect(source).toContain('const languageOptions = useMemo(')
    expect(source).toContain('options={modeOptions}')
    expect(source).toContain('options={fontOptions}')
    expect(source).toContain('options={languageOptions}')
    expect(source).not.toContain('options={Object.entries(LANGUAGES).map')
    expect(source).not.toContain("options={[\n                        { value: 'system'")
    expect(source).not.toContain("options={[\n                        { value: 'inter'")
  })
})
