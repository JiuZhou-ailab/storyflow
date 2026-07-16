// input: Workspace-scoped session ids, metadata, and current selection
// output: Behavioral contract for choosing the writing conversation synchronously
// pos: Regression test that keeps chat activation independent from file-tree/document loading

import { describe, expect, it } from 'bun:test'
import { resolveWritingSessionId } from '../writing-session-selection'

describe('resolveWritingSessionId', () => {
  const sessions = new Map([
    ['other-session', { id: 'other-session', workspaceId: 'other-workspace' }],
    ['current-session', { id: 'current-session', workspaceId: 'current-workspace' }],
  ])

  it('chooses the current workspace conversation from the available session snapshot', () => {
    expect(resolveWritingSessionId({
      sessionIds: ['other-session', 'current-session'],
      sessionMetaMap: sessions,
      selectedSessionId: 'other-session',
      activeWorkspaceId: 'current-workspace',
      remoteWorkspaceId: null,
    })).toBe('current-session')
  })

  it('keeps a valid selected conversation and ignores hidden or archived fallbacks', () => {
    const sessionMetaMap = new Map([
      ['hidden-session', { id: 'hidden-session', workspaceId: 'current-workspace', hidden: true }],
      ['archived-session', { id: 'archived-session', workspaceId: 'current-workspace', isArchived: true }],
      ['selected-session', { id: 'selected-session', workspaceId: 'current-workspace' }],
    ])

    expect(resolveWritingSessionId({
      sessionIds: ['hidden-session', 'archived-session', 'selected-session'],
      sessionMetaMap,
      selectedSessionId: 'selected-session',
      activeWorkspaceId: 'current-workspace',
      remoteWorkspaceId: null,
    })).toBe('selected-session')
  })
})
