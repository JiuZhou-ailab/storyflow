// input: Controlled project-tree props, directory visibility, sidebar focus, and empty-state copy
// output: Self-contained project directory rail with its own toggle and lazy file tree
// pos: Project directory surface beside the writing document

import * as React from 'react'
import { FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import type {
  WorkspaceFileTreeHandle,
  WorkspaceFileTreeProps,
} from './WorkspaceFileTree'

const WorkspaceFileTree = React.lazy(async () => {
  const module = await import('./WorkspaceFileTree')
  return { default: module.WorkspaceFileTree }
})

interface WorkspaceProjectSidebarProps {
  sidebarRef: React.RefObject<HTMLDivElement>
  treeRef: React.RefObject<WorkspaceFileTreeHandle>
  focused: boolean
  loadingLabel: string
  emptyHint: string
  treeProps: WorkspaceFileTreeProps
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  onFocus: React.FocusEventHandler<HTMLDivElement>
}

export function WorkspaceProjectSidebar({
  sidebarRef,
  treeRef,
  focused,
  loadingLabel,
  emptyHint,
  treeProps,
  expanded,
  onExpandedChange,
  onFocus,
}: WorkspaceProjectSidebarProps) {
  const { t } = useTranslation()
  const isEmpty = treeProps.files.length === 0 && treeProps.directories.length === 0
  const toggleLabel = expanded
    ? t('writing.directory.collapse', '收起目录')
    : t('writing.directory.expand', '展开目录')

  return (
    <div
      ref={sidebarRef}
      className="flex h-full min-h-0 flex-col font-sans"
      data-focus-zone="sidebar"
      tabIndex={focused ? 0 : -1}
      onFocus={onFocus}
    >
      <div className={`flex h-[42px] shrink-0 items-center border-b border-foreground/[0.06] ${expanded ? 'justify-end px-2' : 'justify-center'}`}>
        <HeaderIconButton
          icon={<FolderOpen className="h-4 w-4" strokeWidth={1.7} />}
          tooltip={toggleLabel}
          aria-label={toggleLabel}
          aria-expanded={expanded}
          data-state={expanded ? 'open' : 'closed'}
          onClick={() => onExpandedChange(!expanded)}
          className="h-[26px] w-[26px] rounded-lg"
        />
      </div>
      {expanded ? (
        <>
          <React.Suspense fallback={(
            <div className="flex h-full items-center justify-center px-4 text-xs text-muted-foreground">
              {loadingLabel}
            </div>
          )}>
            <WorkspaceFileTree ref={treeRef} {...treeProps} fitContent />
          </React.Suspense>
          {isEmpty ? (
            <div className="shrink-0 border-t border-border/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
              {emptyHint}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
