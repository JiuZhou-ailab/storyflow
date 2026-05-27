import { describe, expect, it } from 'bun:test'
import { getVisibleNovelWorkspaceTabs, NOVEL_WORKSPACE_TABS } from '../novel-workspace-config'

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

  it('hides the analysis tab when no analysis files exist', () => {
    expect(getVisibleNovelWorkspaceTabs({ hasAnalysisFiles: false }).map(tab => tab.id)).toEqual([
      'manuscript',
      'outline',
      'characters',
      'locations',
      'style',
      'state',
      'timeline',
      'work',
      'changes',
    ])
    expect(getVisibleNovelWorkspaceTabs({ hasAnalysisFiles: true }).map(tab => tab.id)).toContain('analysis')
  })

  it('hides the analysis tab for short-form workspaces even when material files exist', () => {
    expect(getVisibleNovelWorkspaceTabs({
      hasAnalysisFiles: true,
      isShortFormWorkspace: true,
    }).map(tab => tab.id)).toEqual([
      'manuscript',
      'outline',
      'characters',
      'locations',
      'style',
      'state',
      'timeline',
      'work',
      'changes',
    ])
  })
})
