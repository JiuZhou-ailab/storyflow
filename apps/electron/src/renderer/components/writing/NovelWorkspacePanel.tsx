// input: Novel workspace files, file changes, and preview callbacks
// output: Tabbed writing workspace surface for manuscript, planning, state, and changes
// pos: Legacy full-panel writing workspace used when the app shell owns normal navigation

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { GitPullRequestArrow, Layers, Library, MapPinned, Palette, ScrollText, Search, UsersRound } from 'lucide-react'
import { Tabs, TabsContent } from '@/components/ui/tabs'
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
import { NovelWorkspaceTabs } from './NovelWorkspaceTabs'
import { NovelSectionList } from './NovelSectionList'
import { NovelDocumentPreview } from './NovelDocumentPreview'
import { NOVEL_WORKSPACE_TABS } from './novel-workspace-config'
import { formatNovelWorkspacePathTitle } from './novel-file-display'

export interface NovelWorkspacePanelProps {
  rootPath: string
  files: NovelWorkspaceFile[]
  changes?: FileChange[]
  onOpenFile?: (path: string) => void
  onReadFile?: (path: string) => Promise<string>
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

export function NovelWorkspacePanel({
  rootPath,
  files,
  changes = [],
  onOpenFile,
  onReadFile,
  className,
}: NovelWorkspacePanelProps) {
  const { t } = useTranslation()
  const tree = React.useMemo(() => buildNovelWorkspaceTree(files), [files])
  const changeGroups = React.useMemo(() => groupNovelFileChanges(changes, rootPath), [changes, rootPath])
  const [activeTab, setActiveTab] = React.useState<NovelWorkspaceTab>(() => selectDefaultNovelTab(tree))
  const [selectedFiles, setSelectedFiles] = React.useState<Partial<Record<NovelWorkspaceTab, NovelWorkspaceFile>>>({})
  const selectedFile = selectedFiles[activeTab]
  const [previewContent, setPreviewContent] = React.useState('')
  const [previewLoading, setPreviewLoading] = React.useState(false)

  React.useEffect(() => {
    setActiveTab(selectDefaultNovelTab(tree))
  }, [tree])

  React.useEffect(() => {
    const sectionId = TAB_TO_SECTION[activeTab]
    if (!sectionId) return
    const current = selectedFiles[activeTab]
    if (current && tree[sectionId].files.some(file => file.path === current.path)) return
    const first = tree[sectionId].files[0]
    if (first) {
      setSelectedFiles(prev => ({ ...prev, [activeTab]: first }))
    }
  }, [activeTab, selectedFiles, tree])

  React.useEffect(() => {
    let cancelled = false
    setPreviewContent('')
    if (!selectedFile || !onReadFile) return
    setPreviewLoading(true)
    onReadFile(selectedFile.path)
      .then((content) => {
        if (!cancelled) setPreviewContent(content)
      })
      .catch(() => {
        if (!cancelled) setPreviewContent('')
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })
    return () => { cancelled = true }
  }, [selectedFile, onReadFile])

  return (
    <div className={cn('flex h-full min-w-0 flex-col bg-background', className)}>
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Library className="h-4 w-4 text-muted-foreground" />
          <div className="min-w-0 truncate text-sm font-medium">{t('writing.workspace')}</div>
        </div>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as NovelWorkspaceTab)}>
          <NovelWorkspaceTabs />
        </Tabs>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as NovelWorkspaceTab)} className="min-h-0 flex-1">
        {NOVEL_WORKSPACE_TABS.filter(tab => tab.id !== 'changes').map((tab) => {
          const sectionId = TAB_TO_SECTION[tab.id]
          if (!sectionId) return null
          const section = tree[sectionId]
          const summary = summarizeNovelSection(section.files)

          return (
            <TabsContent key={tab.id} value={tab.id} className="m-0 h-full min-h-0">
              <div className="grid h-full min-h-0 grid-cols-[minmax(220px,280px)_1fr]">
                <div className="min-h-0 border-r border-border/60">
                  <SectionHeader
                    icon={getTabIcon(tab.id)}
                    label={t(tab.labelKey, tab.fallbackTitle)}
                    count={summary.count}
                  />
                  <div className="h-[calc(100%-40px)]">
                    <NovelSectionList
                      files={section.files}
                      activePath={selectedFiles[tab.id]?.path}
                      onSelectFile={(file) => setSelectedFiles(prev => ({ ...prev, [tab.id]: file }))}
                    />
                  </div>
                </div>
                <NovelDocumentPreview
                  file={selectedFiles[tab.id]}
                  content={selectedFiles[tab.id] ? previewContent : ''}
                  loading={previewLoading}
                  onOpenFile={onOpenFile}
                />
              </div>
            </TabsContent>
          )
        })}

        <TabsContent value="changes" className="m-0 h-full min-h-0">
          <div className="h-full overflow-auto px-4 py-3">
            <SectionHeader
              icon={<GitPullRequestArrow className="h-4 w-4" />}
              label={t('writing.tabs.changes')}
              count={changes.length}
              flush
            />
            <div className="mt-2 divide-y divide-border/60 border-y border-border/60">
              {Object.entries(changeGroups)
                .filter(([, group]) => group.length > 0)
                .map(([category, group]) => (
                  <div key={category} className="py-2">
                    <div className="mb-1 text-xs font-medium capitalize text-foreground/70">{category}</div>
                    {group.map((change) => (
                      <button
                        key={change.id}
                        type="button"
                        title={change.filePath}
                        onClick={() => onOpenFile?.(change.filePath)}
                        className="flex h-8 w-full items-center justify-between gap-3 rounded-[4px] px-2 text-left text-xs hover:bg-foreground/[0.04]"
                      >
                        <span className="min-w-0 truncate">{formatNovelWorkspacePathTitle(change.filePath, rootPath, t)}</span>
                        <span className="shrink-0 text-muted-foreground">{change.toolType}</span>
                      </button>
                    ))}
                  </div>
                ))}
              {changes.length === 0 && (
                <div className="py-12 text-center text-xs text-muted-foreground">{t('writing.emptySection')}</div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SectionHeader({
  icon,
  label,
  count,
  flush = false,
}: {
  icon: React.ReactNode
  label: string
  count: number
  flush?: boolean
}) {
  return (
    <div className={cn('flex h-10 items-center justify-between gap-2 border-b border-border/60 text-xs', flush ? 'px-0' : 'px-3')}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <span className="truncate font-medium">{label}</span>
      </div>
      <span className="rounded-[4px] bg-foreground/[0.05] px-1.5 py-0.5 text-[11px] text-muted-foreground">{count}</span>
    </div>
  )
}

function getTabIcon(tab: NovelWorkspaceTab): React.ReactNode {
  if (tab === 'characters') return <UsersRound className="h-4 w-4" />
  if (tab === 'locations') return <MapPinned className="h-4 w-4" />
  if (tab === 'style') return <Palette className="h-4 w-4" />
  if (tab === 'analysis') return <Search className="h-4 w-4" />
  if (tab === 'work') return <Layers className="h-4 w-4" />
  return <ScrollText className="h-4 w-4" />
}
