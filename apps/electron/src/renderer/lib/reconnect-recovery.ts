import type { SessionMeta } from '@/atoms/sessions'

export type ActiveSessionRefreshState = {
  loaded: boolean
  messageCount: number
}

export function getSessionsToRefreshAfterStaleReconnect(
  metaMap: Map<string, SessionMeta>,
  activeSessionId: string | null,
  activeSessionState?: ActiveSessionRefreshState,
): string[] {
  const refreshIds = new Set<string>()

  if (activeSessionId) {
    const activeMeta = metaMap.get(activeSessionId)
    const expectedMessageCount = activeMeta?.messageCount ?? 0
    if (
      activeMeta?.isProcessing
      || !activeSessionState?.loaded
      || activeSessionState.messageCount < expectedMessageCount
    ) {
      refreshIds.add(activeSessionId)
    }
  }

  for (const [sessionId, meta] of metaMap) {
    if (meta.isProcessing) {
      refreshIds.add(sessionId)
    }
  }

  return [...refreshIds]
}
