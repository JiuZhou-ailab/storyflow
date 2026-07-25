// input: Project-create trigger and create/import/remote callbacks
// output: Compact action menu plus the selected project-creation dialog
// pos: Creation-only entry; project browsing and management live in ActivityRail

import * as React from 'react'
import { Cloud, FolderPlus, Import } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import type { Workspace } from '../../../shared/types'
import { ProjectManagerPanel, type ProjectManagerView } from './ProjectManagerPanel'

export interface ProjectSwitcherPopoverProps {
  onWorkspaceCreated: (workspace: Workspace) => void | Promise<void>
  children: React.ReactElement
}

export function ProjectSwitcherPopover({
  onWorkspaceCreated,
  children,
}: ProjectSwitcherPopoverProps) {
  const [view, setView] = React.useState<ProjectManagerView | null>(null)

  const handleOpenChange = React.useCallback((next: boolean) => {
    if (!next) setView(null)
  }, [])

  const wide = view === 'create'

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <StyledDropdownMenuContent align="end" sideOffset={4}>
          <StyledDropdownMenuItem onClick={() => setView('create')}>
            <FolderPlus className="size-3.5" />
            <span>新建项目</span>
          </StyledDropdownMenuItem>
          <StyledDropdownMenuItem onClick={() => setView('open')}>
            <Import className="size-3.5" />
            <span>导入文件夹</span>
          </StyledDropdownMenuItem>
          <StyledDropdownMenuItem onClick={() => setView('remote')}>
            <Cloud className="size-3.5" />
            <span>连接远端</span>
          </StyledDropdownMenuItem>
        </StyledDropdownMenuContent>
      </DropdownMenu>

      <Dialog open={view !== null} onOpenChange={handleOpenChange}>
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
            event.preventDefault()
          }}
        >
          <DialogTitle className="sr-only">添加项目</DialogTitle>
          <DialogDescription className="sr-only">
            新建项目、导入文件夹或连接远端项目
          </DialogDescription>
          <ProjectManagerPanel
            onWorkspaceCreated={onWorkspaceCreated}
            view={view ?? 'create'}
            onRequestClose={() => handleOpenChange(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
