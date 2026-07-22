// input: Activity rail navigation callbacks and standalone app surface content
// output: Shared shell frame for L0 library / account surfaces outside a project room
// pos: Pre-room AppShell frame; keeps library chrome hierarchical vs the writing room

import type { ReactNode } from 'react'
import { ActivityRail, type ActivityRailItemId, type ActivityRailSurface } from './ActivityRail'
import { WINDOW_TITLE_BAR_HEIGHT } from './layout-constants'

interface ActivityRailFrameProps {
  activeItem: ActivityRailItemId
  /** Defaults to library — frames outside ready never expose room work nav as peers. */
  surface?: ActivityRailSurface
  children: ReactNode
  onOpenProjectHub?: () => void
  onOpenWritingWorkspace?: () => void
  onOpenSearch?: () => void
  onOpenSettings?: () => void
  onOpenAccount?: () => void
}

export function ActivityRailFrame({
  activeItem,
  surface = 'library',
  children,
  onOpenProjectHub,
  onOpenWritingWorkspace,
  onOpenSearch,
  onOpenSettings,
  onOpenAccount,
}: ActivityRailFrameProps) {
  return (
    <div data-testid="activity-rail-frame" data-surface={surface} className="h-full bg-background text-foreground">
      <div
        className="titlebar-drag-region fixed left-0 right-0 top-0 z-panel"
        style={{ height: WINDOW_TITLE_BAR_HEIGHT }}
      >
        <div className="titlebar-no-drag absolute left-0 top-0 h-full w-[80px]" />
      </div>
      <div className="flex h-full min-h-0" style={{ paddingTop: WINDOW_TITLE_BAR_HEIGHT }}>
        <ActivityRail
          surface={surface}
          activeItem={activeItem}
          onOpenProjectHub={onOpenProjectHub}
          onOpenWritingWorkspace={surface === 'room' ? onOpenWritingWorkspace : undefined}
          onOpenSearch={surface === 'room' ? onOpenSearch : undefined}
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
