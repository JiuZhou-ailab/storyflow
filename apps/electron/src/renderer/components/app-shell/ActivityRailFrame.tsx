// input: Activity rail navigation callbacks and standalone app surface content
// output: Shared shell frame for global surfaces outside an active workspace route tree
// pos: Pre-workspace AppShell frame that keeps project and account destinations in the same rail IA

import type { ReactNode } from 'react'
import { ActivityRail, type ActivityRailItemId } from './ActivityRail'
import { WINDOW_TITLE_BAR_HEIGHT } from './layout-constants'

interface ActivityRailFrameProps {
  activeItem: ActivityRailItemId
  children: ReactNode
  onOpenProjectHub?: () => void
  onOpenWritingWorkspace?: () => void
  onOpenSources?: () => void
  onOpenSkills?: () => void
  onOpenSearch?: () => void
  onOpenSettings?: () => void
  onOpenAccount?: () => void
}

export function ActivityRailFrame({
  activeItem,
  children,
  onOpenProjectHub,
  onOpenWritingWorkspace,
  onOpenSources,
  onOpenSkills,
  onOpenSearch,
  onOpenSettings,
  onOpenAccount,
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
          onOpenProjectHub={onOpenProjectHub}
          onOpenWritingWorkspace={onOpenWritingWorkspace}
          onOpenSources={onOpenSources}
          onOpenSkills={onOpenSkills}
          onOpenSearch={onOpenSearch}
          onOpenSettings={onOpenSettings}
          onOpenAccount={onOpenAccount}
        />
        <main className="min-w-0 flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
