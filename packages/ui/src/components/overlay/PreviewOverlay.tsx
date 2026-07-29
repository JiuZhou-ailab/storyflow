// input: Preview content, header metadata, and responsive presentation preferences
// output: Accessible preview rendered inline, fullscreen, or as a modal
// pos: Shared presentation boundary for code, terminal, data, and activity previews
/**
 * PreviewOverlay - Base component for all preview overlays
 *
 * Provides unified presentation logic for modal/fullscreen overlays:
 * - Portal rendering to document.body (via FullscreenOverlayBase for fullscreen mode)
 * - Caller-selected responsive modal vs fullscreen breakpoint
 * - Escape key to close
 * - Backdrop click to close (modal mode)
 * - Consistent header layout with badges, close button
 * - Optional error banner
 *
 * Header and dialog behavior are delegated to FullscreenOverlayBase.
 * Embedded playground previews render the same header inline.
 *
 * Used by: CodePreviewOverlay, TerminalPreviewOverlay, GenericOverlay, etc.
 */

import type { ReactNode } from 'react'
import { type LucideIcon } from 'lucide-react'
import { useOverlayMode } from '../../lib/layout'
import { FullscreenOverlayBase } from './FullscreenOverlayBase'
import { FullscreenOverlayBaseHeader } from './FullscreenOverlayBaseHeader'
import { OverlayErrorBanner } from './OverlayErrorBanner'
import type { PreviewBadgeVariant } from '../ui/PreviewHeader'

/** Badge color variants - re-export for backwards compatibility */
export type BadgeVariant = PreviewBadgeVariant

/** Shared background class for all overlay modes - single source of truth */
const OVERLAY_BG = 'bg-background'

export interface PreviewOverlayProps {
  /** Whether the overlay is visible */
  isOpen: boolean
  /** Callback when the overlay should close */
  onClose: () => void
  /** Theme mode */
  theme?: 'light' | 'dark'

  /** Type badge configuration — tool/format indicator */
  typeBadge: {
    icon: LucideIcon
    label: string
    variant: BadgeVariant
  }

  /** File path — shows dual-trigger menu badge with "Open" + "Reveal in {file manager}" */
  filePath?: string
  /** Title — displayed as badge. Fallback when no file path. */
  title?: string
  /** Callback when title badge is clicked (only used when no filePath) */
  onTitleClick?: () => void
  /** Optional subtitle (e.g., line range info) */
  subtitle?: string

  /** Optional error state */
  error?: {
    label: string
    message: string
  }

  /** Actions to show in header right side */
  headerActions?: ReactNode

  /** Main content */
  children: ReactNode

  /** Render inline (no dialog/portal) — for embedding in design system playground */
  embedded?: boolean

  /** Custom class names for the overlay container (e.g., to override bg-background) */
  className?: string
  /** Optional responsive breakpoint override */
  modalBreakpoint?: number
  /** Content-sized modals shrink to short previews and cap long previews */
  modalSizing?: 'fixed' | 'content'
}

export function PreviewOverlay({
  isOpen,
  onClose,
  theme = 'light',
  typeBadge,
  filePath,
  title,
  onTitleClick,
  subtitle,
  error,
  headerActions,
  children,
  embedded = false,
  className,
  modalBreakpoint,
  modalSizing = 'fixed',
}: PreviewOverlayProps) {
  // Use custom className if provided, otherwise fall back to default bg
  const bgClass = className || OVERLAY_BG
  const responsiveMode = useOverlayMode(modalBreakpoint)
  const isModal = responsiveMode === 'modal'

  if (!isOpen && !embedded) return null

  // Header rendered in modal/embedded mode (fullscreen delegates to FullscreenOverlayBase)
  const header = (
    <FullscreenOverlayBaseHeader
      onClose={onClose}
      typeBadge={typeBadge}
      filePath={filePath}
      title={title}
      onTitleClick={onTitleClick}
      subtitle={subtitle}
      headerActions={headerActions}
    />
  )

  // Error banner — uses shared OverlayErrorBanner with tinted-shadow styling.
  // Rendered inside the centering wrapper so error + content are centered together.
  const errorBanner = error && (
    <div className="px-6 pb-4">
      <OverlayErrorBanner label={error.label} message={error.message} />
    </div>
  )

  // Gradient fade mask for modal/embedded modes — mirrors FullscreenOverlayBase's
  // scroll container structure so children (ContentFrame, etc.) work identically
  // in all modes using flow-based layout inside a scrollable, masked viewport.
  const FADE_SIZE = 24
  const FADE_MASK = `linear-gradient(to bottom, transparent 0%, black ${FADE_SIZE}px, black calc(100% - ${FADE_SIZE}px), transparent 100%)`

  const contentArea = (
    <div
      className="flex-1 min-h-0 relative"
      style={{ maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK }}
    >
      <div
        className="absolute inset-0 overflow-y-auto"
        style={{ paddingTop: FADE_SIZE, paddingBottom: FADE_SIZE, scrollPaddingTop: FADE_SIZE }}
      >
        {/* Centering wrapper — error + content are vertically centered together when small */}
        <div className="min-h-full flex flex-col justify-center">
          {errorBanner}
          {children}
        </div>
      </div>
    </div>
  )

  // Embedded mode — renders inline without dialog/portal, for design system playground
  if (embedded) {
    return (
      <div className={`flex flex-col ${bgClass} h-full w-full overflow-hidden rounded-lg border border-foreground/5`}>
        {header}
        {contentArea}
      </div>
    )
  }

  return (
    <FullscreenOverlayBase
      isOpen={isOpen}
      onClose={onClose}
      mode={responsiveMode}
      modalSizing={modalSizing}
      accessibleTitle={title || typeBadge.label}
      typeBadge={typeBadge}
      filePath={filePath}
      title={title}
      onTitleClick={onTitleClick}
      subtitle={subtitle}
      headerActions={headerActions}
      error={error}
      className={isModal ? bgClass : undefined}
    >
      {children}
    </FullscreenOverlayBase>
  )
}
