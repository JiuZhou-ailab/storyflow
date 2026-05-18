// input: Workspace names displayed inside the fixed top bar
// output: Regression coverage for bounded workspace labels
// pos: Prevents long project names from overlapping header actions

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { formatTopbarWorkspaceName } from '../workspace-switcher-label'

describe('formatTopbarWorkspaceName', () => {
  it('keeps short workspace names unchanged', () => {
    expect(formatTopbarWorkspaceName('短篇')).toBe('短篇')
  })

  it('limits long CJK workspace names to a fixed visible length', () => {
    expect(formatTopbarWorkspaceName('我当着满朝文武的面，把皇丝披满了头发散技能')).toBe('我当着满朝文...')
  })

  it('prevents the topbar workspace label from wrapping', () => {
    const source = readFileSync(new URL('../WorkspaceSwitcher.tsx', import.meta.url), 'utf-8')

    expect(source).toContain('whitespace-nowrap')
  })
})
