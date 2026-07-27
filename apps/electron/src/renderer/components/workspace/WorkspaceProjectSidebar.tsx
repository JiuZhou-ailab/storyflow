// input: Controlled project-tree props, sidebar focus, and empty-state copy
// output: Expanded project directory rail with a lazy file tree
// pos: Project directory surface beside the writing document

import * as React from 'react'
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
  onFocus: React.FocusEventHandler<HTMLDivElement>
}

export function WorkspaceProjectSidebar({
  sidebarRef,
  treeRef,
  focused,
  loadingLabel,
  emptyHint,
  treeProps,
  onFocus,
}: WorkspaceProjectSidebarProps) {
  const isEmpty = treeProps.files.length === 0 && treeProps.directories.length === 0

  return (
    <div
      ref={sidebarRef}
      className="flex h-full min-h-0 flex-col font-sans"
      data-focus-zone="sidebar"
      tabIndex={focused ? 0 : -1}
      onFocus={onFocus}
    >
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
    </div>
  )
}
