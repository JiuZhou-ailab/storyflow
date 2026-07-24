// input: Session metadata events and one renderer-side status mutation
// output: Precise global-refresh policy and ownership-aware optimistic status commits
// pos: Session-status transition boundary independent from the broader session atom store

import type { SessionEvent, SessionStatus } from '../../shared/types'

const latestMutationTokens = new Map<string, symbol>()

export function beginSessionStatusMutation(sessionId: string): symbol {
  const token = Symbol(sessionId)
  latestMutationTokens.set(sessionId, token)
  return token
}

export function ownsSessionStatusMutation(sessionId: string, token: symbol): boolean {
  return latestMutationTokens.get(sessionId) === token
}

export function invalidateSessionStatusMutation(sessionId: string): void {
  latestMutationTokens.delete(sessionId)
}

const GLOBAL_SESSION_META_REFRESH_EVENT_TYPES = new Set<SessionEvent['type']>([
  'complete',
  'interrupted',
  'title_generated',
  'session_deleted',
  'session_created',
  'user_message',
])

/**
 * Global session metadata is a cross-workspace snapshot. Events whose exact
 * fields are already applied to the active workspace atom must not invalidate
 * that whole snapshot; the active atom overlays it until the next workspace
 * mount performs an authoritative load.
 */
export function shouldRefreshGlobalSessionMetasForEvent(eventType: SessionEvent['type']): boolean {
  return GLOBAL_SESSION_META_REFRESH_EVENT_TYPES.has(eventType)
}

interface CommitOptimisticSessionStatusInput {
  nextStatus: SessionStatus
  getCurrentStatus: () => SessionStatus | undefined
  applyStatus: (status: SessionStatus | undefined) => void
  persist: () => Promise<unknown>
  ownsMutation: () => boolean
  onError: (error: unknown) => void
}

export type OptimisticSessionStatusResult =
  | 'unchanged'
  | 'committed'
  | 'rolled_back'
  | 'superseded'

/**
 * Commits one status choice with an ownership-aware rollback.
 *
 * Comparing status values is insufficient because a later choice may return
 * to the same value. Only the latest mutation token may roll itself back.
 */
export async function commitOptimisticSessionStatus({
  nextStatus,
  getCurrentStatus,
  applyStatus,
  persist,
  ownsMutation,
  onError,
}: CommitOptimisticSessionStatusInput): Promise<OptimisticSessionStatusResult> {
  const previousStatus = getCurrentStatus()
  if (previousStatus === nextStatus) return 'unchanged'

  applyStatus(nextStatus)
  try {
    await persist()
    return 'committed'
  } catch (error) {
    if (ownsMutation() && getCurrentStatus() === nextStatus) {
      applyStatus(previousStatus)
      onError(error)
      return 'rolled_back'
    }
    onError(error)
    return 'superseded'
  }
}
