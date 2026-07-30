// input: Local project-create trigger and completion callback
// output: Direct local project-creation dialog
// pos: Single-click creation entry; project browsing and management live in ActivityRail

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import type { Workspace } from '../../../shared/types'
import { ProjectManagerPanel } from './ProjectManagerPanel'

export interface ProjectSwitcherPopoverProps {
  onWorkspaceCreated: (workspace: Workspace) => void | Promise<void>
  children: React.ReactElement
}

export function ProjectSwitcherPopover({
  onWorkspaceCreated,
  children,
}: ProjectSwitcherPopoverProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        showCloseButton
        className="w-[min(760px,calc(100vw-2rem))] max-w-none border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-none"
        data-testid="project-switcher-popover"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          // Keep dialog open while the native folder picker is active.
          event.preventDefault()
        }}
      >
        <DialogTitle className="sr-only">创建本地项目</DialogTitle>
        <DialogDescription className="sr-only">
          选择本地文件夹创建项目，名称可选。
        </DialogDescription>
        <ProjectManagerPanel
          onWorkspaceCreated={onWorkspaceCreated}
          onRequestClose={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
