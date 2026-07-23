// input: Activity rail navigation callbacks and standalone app surface content
// output: Shared shell frame for cold-start project manager and account surfaces
// pos: Pre-room frame; foundation rail stays identical to the room shell

import type { ReactNode } from 'react'
import { ActivityRail, type ActivityRailItemId } from './ActivityRail'
import { WINDOW_TITLE_BAR_HEIGHT } from './layout-constants'
import type { Workspace } from '../../../shared/types'

interface ActivityRailFrameProps {
  activeItem: ActivityRailItemId
  children: ReactNode
  workspaces?: Workspace[]
  activeWorkspaceId?: string | null
  onSelectProject?: (workspaceId: string) => void
  onCreateProject?: () => void
  onImportProject?: () => void
  onConnectRemoteProject?: () => void
  onWorkspaceCreated?: (workspace: Workspace) => void | Promise<void>
  onOpenProjectInNewWindow?: (workspaceId: string) => void
  onRenameProject?: (workspaceId: string, name: string) => void | Promise<void>
  onRemoveProject?: (workspaceId: string) => void | Promise<void>
  onOpenWritingWorkspace?: () => void
  onOpenSources?: () => void
  onOpenSkills?: () => void
  onOpenSearch?: () => void
  onOpenSettings?: () => void
  onOpenAccount?: () => void
  onOpenWhatsNew?: () => void
  whatsNew?: {
    unseen: boolean
    accentColor?: string
    textColor?: string
  }
  projectMenuOpen?: boolean
  onProjectMenuOpenChange?: (open: boolean) => void
}

export function ActivityRailFrame({
  activeItem,
  children,
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
  onOpenWritingWorkspace,
  onOpenSources,
  onOpenSkills,
  onOpenSearch,
  onOpenSettings,
  onOpenAccount,
  onOpenWhatsNew,
  whatsNew,
  projectMenuOpen,
  onProjectMenuOpenChange,
}: ActivityRailFrameProps) {
  return (
    <div data-testid="activity-rail-frame" className="h-full bg-background text-foreground">
      <div
        className="titlebar-drag-region fixed left-0 right-0 top-0 z-panel"
        style={{ height: WINDOW_TITLE_BAR_HEIGHT }}
      >
        <div className="titlebar-no-drag absolute left-0 top-0 h-full w-[80px]" />
      </div>
      <div className="flex h-full min-h-0" style={{ paddingTop: WINDOW_TITLE_BAR_HEIGHT }}>
        <ActivityRail
          activeItem={activeItem}
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
          onOpenWritingWorkspace={onOpenWritingWorkspace}
          onOpenSources={onOpenSources}
          onOpenSkills={onOpenSkills}
          onOpenSearch={onOpenSearch}
          onOpenSettings={onOpenSettings}
          onOpenAccount={onOpenAccount}
          onOpenWhatsNew={onOpenWhatsNew}
          whatsNew={whatsNew}
          projectMenuOpen={projectMenuOpen}
          onProjectMenuOpenChange={onProjectMenuOpenChange}
        />
        <main className="min-w-0 flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
