import type { NovelWorkspaceTab } from '@/lib/writing-workspace'

export interface NovelWorkspaceTabConfig {
  id: NovelWorkspaceTab
  labelKey: `writing.tabs.${NovelWorkspaceTab}`
  fallbackTitle: string
}

export const NOVEL_WORKSPACE_TABS: NovelWorkspaceTabConfig[] = [
  { id: 'manuscript', labelKey: 'writing.tabs.manuscript', fallbackTitle: 'Manuscript' },
  { id: 'outline', labelKey: 'writing.tabs.outline', fallbackTitle: 'Outline' },
  { id: 'characters', labelKey: 'writing.tabs.characters', fallbackTitle: 'Characters' },
  { id: 'locations', labelKey: 'writing.tabs.locations', fallbackTitle: 'Locations' },
  { id: 'style', labelKey: 'writing.tabs.style', fallbackTitle: 'Style' },
  { id: 'state', labelKey: 'writing.tabs.state', fallbackTitle: 'State' },
  { id: 'timeline', labelKey: 'writing.tabs.timeline', fallbackTitle: 'Timeline' },
  { id: 'analysis', labelKey: 'writing.tabs.analysis', fallbackTitle: 'Analysis' },
  { id: 'work', labelKey: 'writing.tabs.work', fallbackTitle: 'Work' },
  { id: 'changes', labelKey: 'writing.tabs.changes', fallbackTitle: 'Changes' },
]

export function getVisibleNovelWorkspaceTabs({
  hasAnalysisFiles,
  includeChanges = true,
  isShortFormWorkspace = false,
}: {
  hasAnalysisFiles: boolean
  includeChanges?: boolean
  isShortFormWorkspace?: boolean
}): NovelWorkspaceTabConfig[] {
  return NOVEL_WORKSPACE_TABS.filter((tab) => {
    if (tab.id === 'changes') return includeChanges
    if (tab.id === 'analysis') return hasAnalysisFiles && !isShortFormWorkspace
    return true
  })
}
