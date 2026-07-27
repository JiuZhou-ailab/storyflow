// input: A resize mode, width, optional resize affordance/header, and column content
// output: A left-handle resizable shell column (sash + panel) for the right side
// pos: Shared shape for the manuscript and directory columns in AppShell

import * as React from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { useResizeGradient } from '@/hooks/useResizeGradient'
import {
  PANEL_SASH_HIT_WIDTH,
  PANEL_SASH_LINE_WIDTH,
  PANEL_SLIDE_OFFSET,
  PANEL_SPRING,
} from './panel-constants'

/** The two right-side columns AppShell drives through this shape. */
export type ResizableColumnMode = 'document-dock' | 'directory-dock'

export interface ResizableColumnProps {
  /** Resize mode forwarded verbatim to onResizeStart. */
  mode: ResizableColumnMode
  /** data-panel-role on both the sash and the panel (e.g. 'document', 'directory'). */
  role: string
  /** Accessible label for the resize separator. */
  sashLabel: string
  /** Begins a drag; owns the width math and persistence. May accept a wider mode union. */
  onResizeStart: (mode: ResizableColumnMode, e: React.MouseEvent<HTMLDivElement>) => void
  /** Current column width in px. */
  width: number
  /** Ref attached to the panel body (used by neighbouring resize math). */
  panelRef?: React.Ref<HTMLDivElement>
  /** Keeps direct resize updates attached to the pointer instead of springing. */
  disableAnimation?: boolean
  /** Whether the left resize sash is interactive. */
  resizable?: boolean
  /** Optional header rendered above the scrolling body. */
  header?: React.ReactNode
  children: React.ReactNode
}

export function ResizableColumn({
  mode,
  role,
  sashLabel,
  onResizeStart,
  width,
  panelRef,
  disableAnimation = false,
  resizable = true,
  header,
  children,
}: ResizableColumnProps) {
  const { ref: sashRef, handlers, gradientStyle } = useResizeGradient()
  const shouldReduceMotion = useReducedMotion()
  const transition = disableAnimation || shouldReduceMotion ? { duration: 0 } : PANEL_SPRING

  return (
    <motion.div
      ref={panelRef}
      data-panel-role={role}
      initial={{ width: 0, x: PANEL_SLIDE_OFFSET, opacity: 0 }}
      animate={{ width, x: 0, opacity: 1 }}
      exit={{ width: 0, x: PANEL_SLIDE_OFFSET, opacity: 0 }}
      transition={transition}
      className="relative h-full min-w-0 shrink-0 bg-background z-panel"
    >
      {resizable ? (
        <div
          ref={sashRef}
          data-panel-role={`${role}-resize-sash`}
          role="separator"
          aria-orientation="vertical"
          aria-label={sashLabel}
          onMouseDown={(e) => {
            handlers.onMouseDown()
            onResizeStart(mode, e)
          }}
          onMouseMove={handlers.onMouseMove}
          onMouseLeave={handlers.onMouseLeave}
          className="absolute inset-y-0 cursor-col-resize z-dropdown"
          style={{
            left: 0,
            width: PANEL_SASH_HIT_WIDTH,
            transform: 'translateX(-50%)',
          }}
        >
          <div
            className="absolute inset-0 flex justify-center cursor-col-resize"
          >
            <div
              className="absolute inset-y-0 left-1/2 -translate-x-1/2"
              style={{
                ...gradientStyle,
                width: PANEL_SASH_LINE_WIDTH,
              }}
            />
          </div>
        </div>
      ) : (
        <div className="absolute inset-y-0 left-0 w-px bg-foreground/[0.06]" />
      )}
      <div
        className="absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute inset-y-0 right-0 flex flex-col"
          style={{ width }}
        >
          {header}
          {header ? (
            <div className="min-h-0 flex-1 overflow-auto">{children}</div>
          ) : children}
        </div>
      </div>
    </motion.div>
  )
}
