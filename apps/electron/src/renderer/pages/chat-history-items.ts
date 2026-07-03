// input: Session metadata values and current workspace scope
// output: Bounded newest-first chat history items
// pos: Pure derivation layer for ChatPage conversation history dropdown

import type { SessionMeta } from '@/atoms/sessions'

interface ConversationHistoryOptions {
  activeWorkspaceId?: string | null
  remoteWorkspaceId?: string | null
  limit?: number
}

export function selectConversationHistoryItems(
  items: Iterable<SessionMeta>,
  { activeWorkspaceId, remoteWorkspaceId, limit = 24 }: ConversationHistoryOptions,
): SessionMeta[] {
  if (limit <= 0) return []

  const selected: SessionMeta[] = []
  for (const item of items) {
    if (!isHistoryItemVisible(item, activeWorkspaceId, remoteWorkspaceId)) continue

    const itemTime = getHistoryItemTime(item)
    let index = 0
    while (index < selected.length && getHistoryItemTime(selected[index]) >= itemTime) {
      index += 1
    }
    selected.splice(index, 0, item)
    if (selected.length > limit) selected.pop()
  }

  return selected
}

function isHistoryItemVisible(
  item: SessionMeta,
  activeWorkspaceId?: string | null,
  remoteWorkspaceId?: string | null,
): boolean {
  return (
    !item.hidden &&
    !item.isArchived &&
    (item.workspaceId === activeWorkspaceId || (!!remoteWorkspaceId && item.workspaceId === remoteWorkspaceId))
  )
}

function getHistoryItemTime(item: SessionMeta): number {
  return item.lastMessageAt || item.createdAt || 0
}
