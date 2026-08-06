// input: Workspace metadata and persisted per-session token totals
// output: Deterministic local usage aggregation by project
// pos: Pure data model for the App settings local usage visualization

import type { Session, Workspace } from '../../../shared/types'

interface WorkspaceUsage {
  id: string
  name: string
  totalTokens: number
}

export interface LocalUsageSummary {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  sessionCount: number
  workspaceUsage: WorkspaceUsage[]
}

export function summarizeLocalUsage(
  workspaces: Pick<Workspace, 'id' | 'name'>[],
  sessionsByWorkspace: Array<Array<Pick<Session, 'tokenUsage'>>>,
): LocalUsageSummary {
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let sessionCount = 0

  const workspaceUsage = workspaces.map((workspace, index) => {
    const sessions = sessionsByWorkspace[index] ?? []
    const workspaceTokens = sessions.reduce((sum, session) => {
      const usage = session.tokenUsage
      inputTokens += usage?.inputTokens ?? 0
      outputTokens += usage?.outputTokens ?? 0
      totalTokens += usage?.totalTokens ?? 0
      return sum + (usage?.totalTokens ?? 0)
    }, 0)

    sessionCount += sessions.length
    return { id: workspace.id, name: workspace.name, totalTokens: workspaceTokens }
  })

  return {
    totalTokens,
    inputTokens,
    outputTokens,
    sessionCount,
    workspaceUsage: workspaceUsage
      .filter((workspace) => workspace.totalTokens > 0)
      .sort((a, b) => b.totalTokens - a.totalTokens),
  }
}
