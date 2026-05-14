// input: Novel workspace file projections and optional file changes
// output: Compact navigator-column UI for writing resources
// pos: Replaces the session-list navigator for novel writing workspaces

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { GitPullRequestArrow, Layers, Library, MapPinned, Palette, ScrollText, Search, UsersRound } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  buildNovelWorkspaceTree,
  groupNovelFileChanges,
  selectDefaultNovelTab,
  summarizeNovelSection,
  type NovelWorkspaceFile,
  type NovelWorkspaceTab,
} from '@/lib/writing-workspace'
import type { FileChange } from '@craft-agent/ui'
import { NOVEL_WORKSPACE_TABS } from './novel-workspace-config'
import { NovelSectionList } from './NovelSectionList'
import { formatNovelWorkspacePathTitle } from './novel-file-display'

export interface NovelWorkspaceNavigatorPanelProps {
  rootPath: string
  files: NovelWorkspaceFile[]
  changes?: FileChange[]
  onOpenFile?: (path: string) => void
  className?: string
}

const TAB_TO_SECTION: Partial<Record<NovelWorkspaceTab, keyof ReturnType<typeof buildNovelWorkspaceTree>>> = {
  manuscript: 'manuscript',
  outline: 'outline',
  characters: 'characters',
  locations: 'locations',
  style: 'style',
  state: 'state',
  timeline: 'timeline',
  analysis: 'analysis',
  work: 'work',
}

export function NovelWorkspaceNavigatorPanel({
  rootPath,
  files,
  changes = [],
  onOpenFile,
  className,
}: NovelWorkspaceNavigatorPanelProps) {
  const { t } = useTranslation()
  const tree = React.useMemo(() => buildNovelWorkspaceTree(files), [files])
  const changeGroups = React.useMemo(() => groupNovelFileChanges(changes, rootPath), [changes, rootPath])
  const [activeTab, setActiveTab] = React.useState<NovelWorkspaceTab>(() => selectDefaultNovelTab(tree))
  const [activePath, setActivePath] = React.useState<string | undefined>(undefined)

  React.useEffect(() => {
    setActiveTab(selectDefaultNovelTab(tree))
    setActivePath(undefined)
  }, [tree])

  const sectionId = TAB_TO_SECTION[activeTab]
  const section = sectionId ? tree[sectionId] : null
  const summary = section ? summarizeNovelSection(section.files) : { count: changes.length }
  const activeTabConfig = NOVEL_WORKSPACE_TABS.find(tab => tab.id === activeTab) ?? NOVEL_WORKSPACE_TABS[0]

  return (
    <div className={cn('flex h-full min-w-0 flex-col bg-background', className)}>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <Library className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 truncate text-sm font-medium">
          {t('writing.workspace')}
        </div>
        <Select value={activeTab} onValueChange={(value) => setActiveTab(value as NovelWorkspaceTab)}>
          <SelectTrigger className="h-8 w-[104px] rounded-[6px] px-2 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NOVEL_WORKSPACE_TABS.map((tab) => (
              <SelectItem key={tab.id} value={tab.id} className="text-xs">
                {t(tab.labelKey, tab.fallbackTitle)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <SectionHeader
        icon={getTabIcon(activeTab)}
        label={t(activeTabConfig.labelKey, activeTabConfig.fallbackTitle)}
        count={summary.count}
      />

      {activeTab === 'changes' ? (
        <ChangesList
          rootPath={rootPath}
          changeGroups={changeGroups}
          changes={changes}
          onOpenFile={onOpenFile}
        />
      ) : section ? (
        <NovelSectionList
          files={section.files}
          activePath={activePath}
          onSelectFile={(file) => {
            setActivePath(file.path)
            onOpenFile?.(file.path)
          }}
          className="min-h-0 flex-1"
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
          {t('writing.emptySection')}
        </div>
      )}
    </div>
  )
}

function SectionHeader({
  icon,
  label,
  count,
}: {
  icon: React.ReactNode
  label: string
  count: number
}) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <span className="truncate font-medium">{label}</span>
      </div>
      <span className="rounded-[4px] bg-foreground/[0.05] px-1.5 py-0.5 text-[11px] text-muted-foreground">
        {count}
      </span>
    </div>
  )
}

function ChangesList({
  rootPath,
  changeGroups,
  changes,
  onOpenFile,
}: {
  rootPath: string
  changeGroups: ReturnType<typeof groupNovelFileChanges>
  changes: FileChange[]
  onOpenFile?: (path: string) => void
}) {
  const { t } = useTranslation()

  if (changes.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
        {t('writing.emptySection')}
      </div>
    )
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="divide-y divide-border/50">
        {Object.entries(changeGroups)
          .filter(([, group]) => group.length > 0)
          .map(([category, group]) => (
            <div key={category} className="py-2">
              <div className="px-3 pb-1 text-[11px] font-medium capitalize text-muted-foreground">
                {category}
              </div>
              {group.map((change) => (
                <button
                  key={change.id}
                  type="button"
                  title={change.filePath}
                  onClick={() => onOpenFile?.(change.filePath)}
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs transition-colors hover:bg-foreground/[0.04]"
                >
                  <GitPullRequestArrow className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{formatNovelWorkspacePathTitle(change.filePath, rootPath, t)}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{change.toolType}</span>
                </button>
              ))}
            </div>
          ))}
      </div>
    </ScrollArea>
  )
}

function getTabIcon(tab: NovelWorkspaceTab): React.ReactNode {
  if (tab === 'characters') return <UsersRound className="h-4 w-4" />
  if (tab === 'locations') return <MapPinned className="h-4 w-4" />
  if (tab === 'style') return <Palette className="h-4 w-4" />
  if (tab === 'analysis') return <Search className="h-4 w-4" />
  if (tab === 'work') return <Layers className="h-4 w-4" />
  if (tab === 'changes') return <GitPullRequestArrow className="h-4 w-4" />
  return <ScrollText className="h-4 w-4" />
}
