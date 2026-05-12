// input: Sessions returned after switching the active workspace
// output: Helpers for selecting an initial session in the switched workspace
// pos: Renderer workspace-switch support shared by App orchestration and tests

import type { Session } from '../../shared/types'

export function getAutoSessionIdForWorkspaceSwitch(
  sessions: Session[],
  workspaceId: string,
  remoteWorkspaceId?: string | null,
): string | null {
  const visibleSessions = sessions
    .filter((session) => {
      if (session.hidden || session.isArchived) return false
      return session.workspaceId === workspaceId || (!!remoteWorkspaceId && session.workspaceId === remoteWorkspaceId)
    })
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))

  return visibleSessions[0]?.id ?? null
}
