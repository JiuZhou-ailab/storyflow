// input: Current runtime workspace and its persisted per-session token totals
// output: Read-only token totals and composition for the active project
// pos: Current-project usage section inside global App settings

import { useEffect, useState } from 'react'
import { Spinner } from '@craft-agent/ui'
import { useTranslation } from 'react-i18next'

import {
  SettingsCard,
  SettingsCardContent,
  SettingsSection,
} from '@/components/settings'
import { useAccountSettings } from '@/context/AppShellContext'
import type { Session } from '../../../shared/types'
import { summarizeLocalUsage, type LocalUsageSummary } from './local-usage'

const COMPACT_NUMBER = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function LocalUsageSection() {
  const { runtimeWorkspace } = useAccountSettings()
  const { t } = useTranslation()
  const [summary, setSummary] = useState<LocalUsageSummary | null>(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSummary(null)
    setLoadError(false)

    if (!runtimeWorkspace) {
      setLoadError(true)
      return () => {
        cancelled = true
      }
    }

    void (async () => {
      try {
        const sessions: Array<Pick<Session, 'tokenUsage'>> = await window.electronAPI.listSessionsByWorkspace(runtimeWorkspace.id)
        if (!cancelled) setSummary(summarizeLocalUsage(sessions))
      } catch (error) {
        console.error('[LocalUsageSection] Failed to load workspace usage:', error)
        if (!cancelled) setLoadError(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [runtimeWorkspace])

  return (
    <SettingsSection
      title={t('settings.app.localUsage.title')}
      description={t('settings.app.localUsage.description')}
    >
      <SettingsCard divided={false}>
        <SettingsCardContent className="p-5">
          {summary ? (
            <UsageContent summary={summary} />
          ) : loadError ? (
            <p className="text-sm text-muted-foreground">{t('settings.app.localUsage.unavailable')}</p>
          ) : (
            <div className="flex min-h-32 items-center justify-center" aria-label={t('settings.app.localUsage.loading')}>
              <Spinner />
            </div>
          )}
        </SettingsCardContent>
      </SettingsCard>
    </SettingsSection>
  )
}

function UsageContent({ summary }: { summary: LocalUsageSummary }) {
  const { t } = useTranslation()
  const compositionTotal = summary.inputTokens + summary.outputTokens
  const inputPercent = compositionTotal > 0
    ? (summary.inputTokens / compositionTotal) * 100
    : 0
  const outputPercent = compositionTotal > 0 ? 100 - inputPercent : 0
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <UsageMetric label={t('settings.app.localUsage.totalTokens')} value={summary.totalTokens} />
        <UsageMetric label={t('settings.app.localUsage.input')} value={summary.inputTokens} />
        <UsageMetric label={t('settings.app.localUsage.output')} value={summary.outputTokens} />
        <UsageMetric label={t('settings.app.localUsage.sessions')} value={summary.sessionCount} compact={false} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
          <span>{t('settings.app.localUsage.composition')}</span>
          <span>{t('settings.app.localUsage.compositionSummary', {
            input: Math.round(inputPercent),
            output: Math.round(outputPercent),
          })}</span>
        </div>
        <div
          className="flex h-2 overflow-hidden rounded-full bg-foreground-2"
          role="img"
          aria-label={t('settings.app.localUsage.compositionAria', {
            input: summary.inputTokens.toLocaleString(),
            output: summary.outputTokens.toLocaleString(),
          })}
        >
          <div className="bg-foreground/70" style={{ width: `${inputPercent}%` }} />
          <div className="bg-accent" style={{ width: `${outputPercent}%` }} />
        </div>
      </div>

    </div>
  )
}

function UsageMetric({
  label,
  value,
  compact = true,
}: {
  label: string
  value: number
  compact?: boolean
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold tabular-nums text-foreground" title={value.toLocaleString()}>
        {compact ? COMPACT_NUMBER.format(value) : value.toLocaleString()}
      </p>
    </div>
  )
}
