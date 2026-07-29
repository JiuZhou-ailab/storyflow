// input: Permission mode, session labels, and label editing callbacks
// output: Permission control and compact label badges above the chat composer
// pos: Optional session metadata strip above the primary input

import * as React from 'react'
import { cn } from '@/lib/utils'
import { LabelIcon, LabelValueTypeIcon } from '@/components/ui/label-icon'
import { LabelValuePopover } from '@/components/ui/label-value-popover'
import type { LabelConfig } from '@craft-agent/shared/labels'
import { flattenLabels, parseLabelEntry, formatLabelEntry } from '@craft-agent/shared/labels'
import { resolveEntityColor } from '@craft-agent/shared/colors'
import { useTheme } from '@/context/ThemeContext'
import { useDynamicStack } from '@/hooks/useDynamicStack'
import { MetadataBadge } from '@/components/ui/metadata-badge'
import type { PermissionMode } from '@craft-agent/shared/agent/modes'
import { DesktopPermissionModeSelector } from './input/DesktopPermissionModeSelector'

export interface ActiveOptionBadgesProps {
  /** Current permission mode */
  permissionMode?: PermissionMode
  /** Callback when permission mode changes */
  onPermissionModeChange?: (mode: PermissionMode) => void
  /** Session ID for scoping label popovers */
  sessionId?: string
  /** Label entries applied to this session (e.g., ["bug", "priority::3"]) */
  sessionLabels?: string[]
  /** Available label configs (tree structure) for resolving label display */
  labels?: LabelConfig[]
  /** Callback when a label is removed (legacy — prefer onLabelsChange) */
  onRemoveLabel?: (labelId: string) => void
  /** Callback when session labels array changes (value edits or removals) */
  onLabelsChange?: (updatedLabels: string[]) => void
  /** Label ID whose value popover should auto-open (set when a valued label is added via # menu) */
  autoOpenLabelId?: string | null
  /** Called after the auto-open has been consumed, so the parent can clear the signal */
  onAutoOpenConsumed?: () => void
  /** Additional CSS classes */
  className?: string
}

/** Resolved label entry: config + parsed value + original index in sessionLabels */
interface ResolvedLabelEntry {
  config: LabelConfig
  rawValue?: string
  index: number
}

export function ActiveOptionBadges({
  permissionMode,
  onPermissionModeChange,
  sessionId,
  sessionLabels = [],
  labels = [],
  onRemoveLabel,
  onLabelsChange,
  autoOpenLabelId,
  onAutoOpenConsumed,
  className,
}: ActiveOptionBadgesProps) {
  const labelById = React.useMemo(
    () => new Map(flattenLabels(labels).map(label => [label.id, label])),
    [labels]
  )

  // Resolve session label entries to their config objects + parsed values.
  // Entries may be bare IDs ("bug") or valued ("priority::3").
  // Preserves the raw value and original index for editing/removal.
  const resolvedLabels = React.useMemo((): ResolvedLabelEntry[] => {
    if (sessionLabels.length === 0 || labelById.size === 0) return []
    const result: ResolvedLabelEntry[] = []
    for (let i = 0; i < sessionLabels.length; i++) {
      const parsed = parseLabelEntry(sessionLabels[i])
      const config = labelById.get(parsed.id)
      if (config) {
        result.push({ config, rawValue: parsed.rawValue, index: i })
      }
    }
    return result
  }, [sessionLabels, labelById])

  const hasLabels = resolvedLabels.length > 0

  // Dynamic stacking with equal visible strips: ResizeObserver computes per-badge
  // margins directly on children. Wider badges get more negative margins so each
  // shows the same visible strip when stacked. No React re-renders needed.
  const stackRef = useDynamicStack({ gap: 8, minVisible: 20, reservedStart: 0 })

  if (!permissionMode && !hasLabels) return null

  return (
    <div className={cn("flex items-start gap-2 mb-2 px-px pt-px pb-0.5", className)}>
      <div className="flex items-start gap-2 min-w-0 flex-1">
        {permissionMode && (
          <DesktopPermissionModeSelector
            permissionMode={permissionMode}
            onPermissionModeChange={onPermissionModeChange}
            sessionId={sessionId}
          />
        )}

        {/* Stacking container for label badges.
         * useDynamicStack sets per-child marginLeft directly via ResizeObserver.
         * overflow: clip prevents scroll container while py/-my gives shadow room. */}
        {hasLabels && <div
          className="flex-1 min-w-0 max-w-full py-0.5 -my-0.5"
          style={{
            // shadow-minimal replicated as drop-shadow (traces masked alpha, no clipping).
            // Ring uses higher blur+opacity for visible border feel (hard 1px ring can't be replicated exactly).
            // Blur shadows use reduced blur+opacity to stay tight (accounting for no negative spread in drop-shadow).
            filter: 'drop-shadow(0px 0px 0.5px rgba(var(--foreground-rgb), 0.3)) drop-shadow(0px 1px 0.1px rgba(0,0,0,0.04)) drop-shadow(0px 3px 0.2px rgba(0,0,0,0.03))',
          }}
        >
          <div
            ref={stackRef}
            className="flex items-center min-w-0 py-1 -my-1"
            style={{ overflow: 'clip' }}
          >
            {resolvedLabels.map(({ config, rawValue, index }) => (
              <LabelBadge
                key={`${config.id}-${index}`}
                label={config}
                value={rawValue}
                autoOpen={config.id === autoOpenLabelId}
                onAutoOpenConsumed={onAutoOpenConsumed}
                sessionId={sessionId}
                onValueChange={(newValue) => {
                  const updated = [...sessionLabels]
                  updated[index] = formatLabelEntry(config.id, newValue)
                  onLabelsChange?.(updated)
                }}
                onRemove={() => {
                  if (onLabelsChange) {
                    onLabelsChange(sessionLabels.filter((_, i) => i !== index))
                  } else {
                    onRemoveLabel?.(config.id)
                  }
                }}
              />
            ))}
          </div>
        </div>}
      </div>
    </div>
  )
}

// ============================================================================
// Label Badge Component
// ============================================================================

/**
 * Format a raw value for display based on the label's valueType.
 * Dates render as locale short format; numbers and strings pass through.
 */
function formatDisplayValue(rawValue: string, valueType?: 'string' | 'number' | 'date'): string {
  if (valueType === 'date') {
    const date = new Date(rawValue.includes('T') ? rawValue + ':00Z' : rawValue + 'T00:00:00Z')
    if (!isNaN(date.getTime())) {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }
  }
  return rawValue
}

/**
 * Renders a single label badge with LabelValuePopover for editing/removal.
 * No box-shadow on the badge itself — all shadows come from the parent
 * wrapper's drop-shadow filter (traces masked alpha without clipping).
 * Shows: [color circle] [name] [· value in mono] [chevron]
 */
function LabelBadge({
  label,
  value,
  autoOpen,
  onAutoOpenConsumed,
  onValueChange,
  onRemove,
  sessionId,
}: {
  label: LabelConfig
  value?: string
  /** When true, auto-open the value popover on mount (for newly added valued labels) */
  autoOpen?: boolean
  onAutoOpenConsumed?: () => void
  onValueChange?: (newValue: string | undefined) => void
  onRemove: () => void
  sessionId?: string
}) {
  const { isDark } = useTheme()
  const [open, setOpen] = React.useState(false)

  // Auto-open the value popover when this label was just added via # menu
  // and has a valueType. Opens exactly once, then clears the signal.
  React.useEffect(() => {
    if (autoOpen && label.valueType) {
      setOpen(true)
      onAutoOpenConsumed?.()
    }
  }, [autoOpen, label.valueType, onAutoOpenConsumed])

  // Resolve label color for tinting background and text via CSS color-mix
  const resolvedColor = label.color
    ? resolveEntityColor(label.color, isDark)
    : 'var(--foreground)'

  const displayValue = value ? formatDisplayValue(value, label.valueType) : undefined

  return (
    <LabelValuePopover
      label={label}
      value={value}
      open={open}
      onOpenChange={setOpen}
      onValueChange={onValueChange}
      onRemove={onRemove}
      sessionId={sessionId}
    >
      <MetadataBadge
        label={label.name}
        value={displayValue}
        icon={<LabelIcon label={label} size="lg" />}
        valueHintIcon={label.valueType ? <LabelValueTypeIcon valueType={label.valueType} /> : undefined}
        badgeColor={resolvedColor}
        interactive
        isActive={open}
        showChevron
        shadow="none"
        className="relative"
      />
    </LabelValuePopover>
  )
}
