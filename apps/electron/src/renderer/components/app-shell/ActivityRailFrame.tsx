// input: Activity rail props and standalone surface children
// output: Title-bar frame wrapping the foundation ActivityRail
// pos: Pre-room shell; rail props pass through unchanged

import type { ReactNode } from 'react'
import { ActivityRail, type ActivityRailProps } from './ActivityRail'
import { WINDOW_TITLE_BAR_HEIGHT } from './layout-constants'

export type ActivityRailFrameProps = ActivityRailProps & {
  children: ReactNode
}

export function ActivityRailFrame({ children, ...railProps }: ActivityRailFrameProps) {
  return (
    <div data-testid="activity-rail-frame" className="h-full bg-background text-foreground">
      <div
        className="titlebar-drag-region fixed left-0 right-0 top-0 z-panel"
        style={{ height: WINDOW_TITLE_BAR_HEIGHT }}
      >
        <div className="titlebar-no-drag absolute left-0 top-0 h-full w-[80px]" />
      </div>
      <div className="flex h-full min-h-0">
        <ActivityRail {...railProps} />
        <main
          className="min-w-0 flex-1 overflow-auto"
          style={{ paddingTop: WINDOW_TITLE_BAR_HEIGHT }}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
