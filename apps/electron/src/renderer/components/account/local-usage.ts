// input: Persisted per-session token totals for one runtime workspace
// output: Deterministic usage aggregation for the active project
// pos: Pure data model for the App settings usage visualization

import type { Session } from '../../../shared/types'

export interface LocalUsageSummary {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  sessionCount: number
}

export function summarizeLocalUsage(
  sessions: Array<Pick<Session, 'tokenUsage'>>,
): LocalUsageSummary {
  return sessions.reduce<LocalUsageSummary>((summary, session) => ({
    totalTokens: summary.totalTokens + (session.tokenUsage?.totalTokens ?? 0),
    inputTokens: summary.inputTokens + (session.tokenUsage?.inputTokens ?? 0),
    outputTokens: summary.outputTokens + (session.tokenUsage?.outputTokens ?? 0),
    sessionCount: summary.sessionCount + 1,
  }), { totalTokens: 0, inputTokens: 0, outputTokens: 0, sessionCount: 0 })
}
