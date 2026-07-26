// input: Desktop shell split-pane geometry requirements
// output: Shared gap, edge, width, sash, and motion constants
// pos: Single geometry contract for the continuous app workbench

/** Structural panes share one separator instead of carrying card gaps. */
export const PANEL_GAP = 0

/** The native window owns the outer edge. */
export const PANEL_EDGE_INSET = 0

/** Minimum width for any content panel */
export const PANEL_MIN_WIDTH = 440

/**
 * Shared resize sash geometry.
 *
 * Keep all seams (sidebar, navigator/content, panel/panel) aligned by deriving
 * offsets from these constants instead of hardcoded pixel literals.
 */
export const PANEL_SASH_HIT_WIDTH = 8
export const PANEL_SASH_LINE_WIDTH = 1

/** Half-width helper for centering sash containers on seam coordinates. */
export const PANEL_SASH_HALF_HIT_WIDTH = PANEL_SASH_HIT_WIDTH / 2

/** Shared no-bounce motion for panel visibility changes. */
export const PANEL_SPRING = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 38,
  mass: 0.9,
}

/** Horizontal travel keeps panel visibility changes spatial rather than fade-only. */
export const PANEL_SLIDE_OFFSET = 20
