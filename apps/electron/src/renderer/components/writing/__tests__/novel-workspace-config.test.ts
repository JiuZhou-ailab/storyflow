import { describe, expect, it } from 'bun:test'
import { NOVEL_WORKSPACE_TABS } from '../novel-workspace-config'

describe('NOVEL_WORKSPACE_TABS', () => {
  it('keeps the expected writing workspace tab order', () => {
    expect(NOVEL_WORKSPACE_TABS.map(tab => tab.id)).toEqual([
      'manuscript',
      'outline',
      'characters',
      'locations',
      'style',
      'state',
      'timeline',
      'analysis',
      'work',
      'changes',
    ])
  })

  it('uses i18n keys for every tab label', () => {
    for (const tab of NOVEL_WORKSPACE_TABS) {
      expect(tab.labelKey).toBe(`writing.tabs.${tab.id}`)
    }
  })
})
