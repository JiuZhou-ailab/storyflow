// input: File-tab header, document surface, and optional directory with its existing resize handler
// output: Shared workspace chrome above a document and right-hand directory
// pos: Layout boundary reused by project workspaces and conversation file previews

import type * as React from 'react'
import { AnimatePresence } from 'motion/react'
import { ResizableColumn, type ResizableColumnMode } from '../app-shell/ResizableColumn'

interface Props {
  header: React.ReactNode
  children: React.ReactNode
  directory?: React.ReactNode
  directoryWidth: number
  directoryLabel: string
  onDirectoryResize?: (mode: ResizableColumnMode, event: React.MouseEvent<HTMLDivElement>) => void
  resizingDirectory?: boolean
  compact?: boolean
}

export function WorkspaceDockLayout({ header, children, directory, directoryWidth, directoryLabel, onDirectoryResize, resizingDirectory, compact }: Props) {
  return (
    <div className="flex h-full min-w-0 flex-col">
      {header}
      <div className={`flex min-h-0 flex-1 ${compact ? 'flex-col-reverse' : ''}`}>
        <div className="min-h-0 min-w-0 flex-1">{children}</div>
        <AnimatePresence initial={false}>
          {directory ? compact ? (
            <div key="workspace-directory" className="max-h-44 shrink-0 overflow-auto border-b border-foreground/[0.06]">{directory}</div>
          ) : (
            <ResizableColumn
              key="workspace-directory"
              mode="directory-dock"
              role="directory"
              sashLabel={directoryLabel}
              onResizeStart={onDirectoryResize ?? (() => {})}
              resizable={!!onDirectoryResize}
              width={directoryWidth}
              disableAnimation={resizingDirectory}
            >
              {directory}
            </ResizableColumn>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}
