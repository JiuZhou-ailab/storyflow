// input: Session state + messages_rewound events
// output: Regression checks for in-place rewind transcript replacement
// pos: Guards renderer projection of Pi-native same-session rewind

import { describe, expect, it } from 'bun:test'
import { handleMessagesRewound } from '../session'
import type { SessionState } from '../../types'

function makeState(messageIds: string[]): SessionState {
  return {
    session: {
      id: 's1',
      workspaceId: 'w1',
      workspaceName: 'W',
      name: 'Chat',
      messages: messageIds.map((id, index) => ({
        id,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: id,
        timestamp: index,
      })),
      isProcessing: true,
      lastFinalMessageId: 'a2',
      messageCount: messageIds.length,
      createdAt: 0,
      updatedAt: 0,
      lastMessageAt: 0,
    } as SessionState['session'],
    streaming: { content: 'partial', turnId: 't1' },
  }
}

describe('handleMessagesRewound', () => {
  it('replaces the transcript and derives meta from remaining messages', () => {
    const state = makeState(['u1', 'a1', 'u2', 'a2'])
    const next = handleMessagesRewound(state, {
      type: 'messages_rewound',
      sessionId: 's1',
      messages: [
        { id: 'u1', role: 'user', content: 'hello', timestamp: 0 },
        { id: 'a1', role: 'assistant', content: 'a1', timestamp: 1 },
      ],
    })

    expect(next.state.session.messages.map(m => m.id)).toEqual(['u1', 'a1'])
    expect(next.state.session.isProcessing).toBe(false)
    expect(next.state.streaming).toBeNull()
    expect(next.state.session.lastFinalMessageId).toBe('a1')
    expect(next.state.session.messageCount).toBe(2)
    expect(next.state.session.preview).toBe('hello')
    expect(next.state.session.lastMessageRole).toBe('assistant')
  })

  it('clears lastFinalMessageId when the truncated path has no assistant', () => {
    const state = makeState(['u1', 'a1'])
    const next = handleMessagesRewound(state, {
      type: 'messages_rewound',
      sessionId: 's1',
      messages: [],
    })

    expect(next.state.session.messages).toEqual([])
    expect(next.state.session.lastFinalMessageId).toBeUndefined()
    expect(next.state.session.messageCount).toBe(0)
  })
})
