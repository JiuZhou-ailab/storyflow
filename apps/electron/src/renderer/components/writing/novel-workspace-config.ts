import type { NovelWorkspaceTab } from '@/lib/writing-workspace'

export interface NovelWorkspaceTabConfig {
  id: NovelWorkspaceTab
  labelKey: `writing.tabs.${NovelWorkspaceTab}`
}

export const NOVEL_WORKSPACE_TABS: NovelWorkspaceTabConfig[] = [
  { id: 'manuscript', labelKey: 'writing.tabs.manuscript' },
  { id: 'outline', labelKey: 'writing.tabs.outline' },
  { id: 'characters', labelKey: 'writing.tabs.characters' },
  { id: 'locations', labelKey: 'writing.tabs.locations' },
  { id: 'state', labelKey: 'writing.tabs.state' },
  { id: 'timeline', labelKey: 'writing.tabs.timeline' },
  { id: 'changes', labelKey: 'writing.tabs.changes' },
]
