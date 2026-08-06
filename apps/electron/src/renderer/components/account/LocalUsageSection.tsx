// input: Workspace-scoped session metadata exposed by the existing Electron API
// output: Read-only local token totals, composition, and project distribution
// pos: Local usage section inside global App settings

import { useEffect, useState } from 'react'
import { Spinner } from '@craft-agent/ui'
import { useTranslation } from 'react-i18next'
import { FREE_CONVERSATION_WORKSPACE_ID } from '@craft-agent/shared/protocol'

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
  const { workspaces } = useAccountSettings()
  const { t } = useTranslation()
  const [summary, setSummary] = useState<LocalUsageSummary | null>(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const usageWorkspaces = [
      { id: FREE_CONVERSATION_WORKSPACE_ID, name: t('settings.app.localUsage.freeConversations') },
      ...workspaces,
    ]

    void (async () => {
      const successfulWorkspaces: typeof usageWorkspaces = []
      const sessionsByWorkspace: Array<Array<Pick<Session, 'tokenUsage'>>> = []
      for (const workspace of usageWorkspaces) {
        if (cancelled) return
        try {
          sessionsByWorkspace.push(await window.electronAPI.listSessionsByWorkspace(workspace.id))
          successfulWorkspaces.push(workspace)
        } catch (error) {
          console.error('[LocalUsageSection] Failed to load workspace usage:', error)
        }
      }
      if (cancelled) return
      setLoadError(successfulWorkspaces.length !== usageWorkspaces.length)
      setSummary(successfulWorkspaces.length > 0
        ? summarizeLocalUsage(successfulWorkspaces, sessionsByWorkspace)
        : null)
    })()

    return () => {
      cancelled = true
    }
  }, [t, workspaces])

  return (
    <SettingsSection
      title={t('settings.app.localUsage.title')}
      description={t('settings.app.localUsage.description')}
    >
      <SettingsCard divided={false}>
        <SettingsCardContent className="p-5">
          {summary ? (
            <>
              <UsageContent summary={summary} />
              {loadError ? (
                <p className="mt-4 text-xs text-muted-foreground">{t('settings.app.localUsage.partial')}</p>
              ) : null}
            </>
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
  const maxWorkspaceTokens = summary.workspaceUsage[0]?.totalTokens ?? 0

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

      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">{t('settings.app.localUsage.byProject')}</p>
        {summary.workspaceUsage.length > 0 ? (
          <div className="space-y-3">
            {summary.workspaceUsage.slice(0, 5).map((workspace) => (
              <div key={workspace.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-4 text-xs">
                  <span className="truncate text-foreground">{workspace.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {COMPACT_NUMBER.format(workspace.totalTokens)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-foreground-2">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${(workspace.totalTokens / maxWorkspaceTokens) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('settings.app.localUsage.empty')}</p>
        )}
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
