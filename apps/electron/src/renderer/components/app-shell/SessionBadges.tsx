import { parseLabelEntry } from "@craft-agent/shared/labels"
import { EntityListLabelBadge } from "@/components/ui/entity-list-label-badge"
import { useSessionListContext } from "@/context/SessionListContext"
import type { SessionMeta } from "@/atoms/sessions"
import type { LabelConfig } from "@craft-agent/shared/labels"

export interface ResolvedSessionLabelBadge {
  config: LabelConfig
  rawValue: string | undefined
}

interface SessionBadgesProps {
  item: SessionMeta
  resolvedLabels: ResolvedSessionLabelBadge[]
}

export function resolveSessionLabelBadges(
  sessionLabels: string[] | undefined,
  labelById: Map<string, LabelConfig>
): ResolvedSessionLabelBadge[] {
  if (!sessionLabels || sessionLabels.length === 0 || labelById.size === 0) return []
  return sessionLabels
    .map(entry => {
      const parsed = parseLabelEntry(entry)
      const config = labelById.get(parsed.id)
      if (!config) return null
      return { config, rawValue: parsed.rawValue }
    })
    .filter((label): label is ResolvedSessionLabelBadge => label != null)
}

export function SessionBadges({ item, resolvedLabels }: SessionBadgesProps) {
  const ctx = useSessionListContext()
  if (resolvedLabels.length === 0) return null

  return (
    <>
      {resolvedLabels.map(({ config, rawValue }, idx) => (
        <EntityListLabelBadge
          key={`${config.id}-${idx}`}
          label={config}
          rawValue={rawValue}
          sessionLabels={item.labels || []}
          onLabelsChange={(updated) => ctx.onLabelsChange?.(item.id, updated)}
        />
      ))}
    </>
  )
}
