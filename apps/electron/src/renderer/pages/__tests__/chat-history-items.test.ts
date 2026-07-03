// input: Session metadata values used by chat history dropdown
// output: Regression coverage for bounded recent-session selection
// pos: Keeps chat history menu derivation cheap for large session maps

import { describe, expect, it } from 'bun:test'
import type { SessionMeta } from '../../atoms/sessions'
import { selectConversationHistoryItems } from '../chat-history-items'

function session(overrides: Partial<SessionMeta> & Pick<SessionMeta, 'id' | 'workspaceId'>): SessionMeta {
  return {
    id: overrides.id,
    workspaceId: overrides.workspaceId,
    createdAt: overrides.createdAt,
    lastMessageAt: overrides.lastMessageAt,
    hidden: overrides.hidden,
    isArchived: overrides.isArchived,
  }
}

describe('selectConversationHistoryItems', () => {
  it('keeps only visible sessions from active or remote workspaces ordered newest first', () => {
    const items = [
      session({ id: 'old', workspaceId: 'local', createdAt: 10 }),
      session({ id: 'remote-new', workspaceId: 'remote', lastMessageAt: 40 }),
      session({ id: 'hidden', workspaceId: 'local', lastMessageAt: 50, hidden: true }),
      session({ id: 'archived', workspaceId: 'local', lastMessageAt: 60, isArchived: true }),
      session({ id: 'other', workspaceId: 'other', lastMessageAt: 70 }),
      session({ id: 'local-new', workspaceId: 'local', lastMessageAt: 30 }),
    ]

    expect(selectConversationHistoryItems(items, {
      activeWorkspaceId: 'local',
      remoteWorkspaceId: 'remote',
      limit: 2,
    }).map(item => item.id)).toEqual(['remote-new', 'local-new'])
  })
})
