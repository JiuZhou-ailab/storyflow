// input: Panel title metadata, optional title menus, leading controls, and right-side actions
// output: Centered panel header chrome shared by app shell panels
// pos: Common header layout primitive for renderer panels

/**
 * PanelHeader - Standardized header component for panels
 *
 * Provides consistent header styling with:
 * - Fixed 50px height
 * - Title with optional badge
 * - Optional action buttons
 * - Optional title dropdown menu (renders chevron and makes title interactive)
 * - Automatic padding compensation for macOS traffic lights (via StoplightContext)
 *
 * Usage:
 * ```tsx
 * <PanelHeader
 *   title="Conversations"
 *   actions={<Button>Add</Button>}
 * />
 *
 * // With interactive title menu:
 * <PanelHeader
 *   title="Chat Name"
 *   titleMenu={<><MenuItem>Rename</MenuItem><MenuItem>Delete</MenuItem></>}
 * />
 * ```
 *
 * The header automatically compensates for macOS traffic lights when rendered
 * inside a StoplightProvider (e.g., in MainContentPanel during focused mode).
 * You can also explicitly control this with the `compensateForStoplight` prop.
 */

import * as React from 'react'
import { useState } from 'react'
import { motion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCompensateForStoplight } from '@/context/StoplightContext'
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { StyledDropdownMenuContent } from '@/components/ui/styled-dropdown'

// Spring transition for smooth animations (matches sidebar)
const springTransition = { type: 'spring' as const, stiffness: 300, damping: 30 }

// Padding to compensate for macOS traffic lights (stoplight buttons)
// Traffic lights positioned at x:18, ~52px wide = 70px + 14px gap
const STOPLIGHT_PADDING = 84

export interface PanelHeaderProps {
  /** Header title (undefined hides with animation) */
  title?: string
  /** Optional badge element (e.g., agent badge) */
  badge?: React.ReactNode
  /** Optional dropdown menu content for interactive title (renders chevron when provided) */
  titleMenu?: React.ReactNode
  /** Optional leading action rendered before the title (e.g., back button in compact mode) */
  leadingAction?: React.ReactNode
  /** Optional center button rendered between title and right actions */
  centerButton?: React.ReactNode
  /** Optional action buttons rendered on the right */
  actions?: React.ReactNode
  /** Optional right sidebar button (rendered after actions) */
  rightSidebarButton?: React.ReactNode
  /** When true, animates left margin to avoid macOS traffic lights (use when this is the first panel on screen) */
  compensateForStoplight?: boolean
  /** Left padding override (e.g., for focused mode with traffic lights) */
  paddingLeft?: string
  /** Optional className for additional styling */
  className?: string
  /** Whether title is being regenerated (shows shimmer effect) */
  isRegeneratingTitle?: boolean
}

/**
 * Standardized panel header with title and actions
 */
export function PanelHeader({
  title,
  badge,
  titleMenu,
  leadingAction,
  centerButton,
  actions,
  rightSidebarButton,
  compensateForStoplight,
  paddingLeft,
  className,
  isRegeneratingTitle,
}: PanelHeaderProps) {
  // Use context as fallback when prop is not explicitly set.
  // Skip stoplight compensation when leadingAction is present — the back button
  // occupies the space where traffic lights would be.
  const contextCompensate = useCompensateForStoplight()
  const shouldCompensate = leadingAction ? false : (compensateForStoplight ?? contextCompensate)

  // Controlled dropdown state for anchoring to chevron while keeping full title clickable
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // Title content - either static or interactive with dropdown
  // Shimmer effect shows during title regeneration
  const titleContent = (
    <motion.div
      initial={false}
      animate={{ opacity: title ? 1 : 0 }}
      transition={{ duration: 0.15 }}
      className="flex min-w-0 items-center justify-center gap-1"
    >
      <h1 className={cn(
        "min-w-0 truncate text-center text-[13px] font-medium leading-none",
        isRegeneratingTitle && "animate-shimmer-text"
      )}>{title}</h1>
      {badge}
    </motion.div>
  )

  const content = (
    <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,auto)_minmax(0,1fr)] items-center gap-1.5">
      <div className="titlebar-no-drag min-w-0 flex items-center justify-start">
        {leadingAction}
      </div>
      <div className="min-w-0 flex items-center justify-center select-none">
        <div className="max-w-full overflow-hidden">
          {titleMenu ? (
            <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
              {/* Wrapper button for the whole clickable area */}
              <button
                type="button"
                onClick={() => setDropdownOpen(true)}
                className={cn(
                  "flex h-7 max-w-full items-center justify-center gap-1 rounded-md px-2 titlebar-no-drag min-w-0",
                  "hover:bg-foreground/[0.03] transition-colors",
                  "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  dropdownOpen && "bg-foreground/[0.03]"
                )}
              >
                {titleContent}
                {/* Chevron is the actual trigger anchor point */}
                <DropdownMenuTrigger asChild>
                  <span className="shrink-0 flex items-center justify-center">
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                </DropdownMenuTrigger>
              </button>
              <StyledDropdownMenuContent align="center" sideOffset={8}>
                {titleMenu}
              </StyledDropdownMenuContent>
            </DropdownMenu>
          ) : (
            titleContent
          )}
        </div>
      </div>
      <div className="titlebar-no-drag min-w-0 flex items-center justify-end gap-1">
        {centerButton}
        {actions}
        {rightSidebarButton}
      </div>
    </div>
  )

  // Base padding (16px = pl-4, matches pr-2 when leading action present for symmetry)
  const basePadding = leadingAction ? 8 : 16

  const baseClassName = cn(
    'flex shrink-0 items-center pr-2 min-w-0 gap-1.5 relative z-panel h-[42px]',
    // Only use static paddingLeft class when not animating
    !shouldCompensate && (paddingLeft || (leadingAction ? 'pl-2' : 'pl-4')),
    className
  )

  // Use motion.div with animated paddingLeft to shift content while keeping background full-width
  return (
    <motion.div
      initial={false}
      animate={{ paddingLeft: shouldCompensate ? STOPLIGHT_PADDING : basePadding }}
      transition={springTransition}
      className={baseClassName}
    >
      {content}
    </motion.div>
  )
}
