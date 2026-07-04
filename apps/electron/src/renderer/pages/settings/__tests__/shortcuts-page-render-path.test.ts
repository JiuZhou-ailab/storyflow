// input: ShortcutsPage source
// output: Regression checks for shortcut settings render-path derived arrays
// pos: Guards shortcut settings from rebuilding static section arrays on every render

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../ShortcutsPage.tsx', import.meta.url), 'utf8')

describe('ShortcutsPage render path', () => {
  it('reuses shortcut category entries and memoizes component-specific sections', () => {
    expect(source).toContain('const ACTION_CATEGORY_ENTRIES = Object.entries(actionsByCategory)')
    expect(source).toContain('return React.useMemo(() => [')
    expect(source).toContain('], [t])')
    expect(source).toContain('ACTION_CATEGORY_ENTRIES.map(([category, actions]) =>')
    expect(source).not.toContain('Object.entries(actionsByCategory).map')
  })
})
