// input: Workspace list and project management callbacks
// output: Large centered dialog hosting ProjectManagerPanel (list + inline create)
// pos: In-room project switcher/manager; create/import/remote stay in-dialog

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import type { Workspace } from '../../../shared/types'
import { ProjectManagerPanel, type ProjectManagerView } from './ProjectManagerPanel'

export interface ProjectSwitcherPopoverProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelectProject: (workspaceId: string) => void
  onCreateProject?: () => void
  onImportProject?: () => void
  onConnectRemoteProject?: () => void
  onWorkspaceCreated?: (workspace: Workspace) => void | Promise<void>
  onOpenProjectInNewWindow?: (workspaceId: string) => void
  onRenameProject?: (workspaceId: string, name: string) => void | Promise<void>
  onRemoveProject?: (workspaceId: string) => void | Promise<void>
  children: React.ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** @deprecated Side alignment no longer applies; dialog is always centered. */
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** @deprecated Align no longer applies; dialog is always centered. */
  align?: 'start' | 'center' | 'end'
}

export function ProjectSwitcherPopover({
  workspaces,
  activeWorkspaceId,
  onSelectProject,
  onCreateProject,
  onImportProject,
  onConnectRemoteProject,
  onWorkspaceCreated,
  onOpenProjectInNewWindow,
  onRenameProject,
  onRemoveProject,
  children,
  open: openProp,
  onOpenChange,
}: ProjectSwitcherPopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const [view, setView] = React.useState<ProjectManagerView>('list')
  const open = openProp ?? uncontrolledOpen
  const setOpen = onOpenChange ?? setUncontrolledOpen

  const handleOpenChange = React.useCallback((next: boolean) => {
    setOpen(next)
    if (!next) setView('list')
  }, [setOpen])

  const wide = view === 'create'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        showCloseButton
        className={
          wide
            ? 'w-[min(1040px,calc(100vw-2rem))] max-w-none border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-none'
            : 'w-[min(760px,calc(100vw-2rem))] max-w-none border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-none'
        }
        data-testid="project-switcher-popover"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          // Keep dialog open while OS folder picker / nested menus are used.
          if (view !== 'list') event.preventDefault()
        }}
      >
        <DialogTitle className="sr-only">项目管理</DialogTitle>
        <DialogDescription className="sr-only">
          浏览最近项目，或在同一弹窗内新建、导入、连接远端项目
        </DialogDescription>
        <ProjectManagerPanel
          variant="dialog"
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSelectProject={onSelectProject}
          onCreateProject={onCreateProject}
          onImportProject={onImportProject}
          onConnectRemoteProject={onConnectRemoteProject}
          onWorkspaceCreated={onWorkspaceCreated}
          onOpenProjectInNewWindow={onOpenProjectInNewWindow}
          onRenameProject={onRenameProject}
          onRemoveProject={onRemoveProject}
          view={view}
          onViewChange={setView}
          onRequestClose={() => handleOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
