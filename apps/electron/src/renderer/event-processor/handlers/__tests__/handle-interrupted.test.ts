import { describe, expect, it } from 'bun:test'
import { handleInterrupted, handleUserMessage } from '../session'
import { processEvent } from '../../processor'
import type { SessionState, InterruptedEvent, UserMessageEvent } from '../../types'

function makeState(messages: any[]): SessionState {
  return {
    session: {
      id: 'session-1',
      messages,
      lastMessageAt: Date.now(),
      isProcessing: true,
    } as any,
    streaming: null,
  }
}

describe('handleInterrupted (#616)', () => {
  describe('user-initiated stop (event.message present)', () => {
    it('removes queued bubbles AND emits restore_input', () => {
      const state = makeState([
        { id: 'msg-1', role: 'user', content: 'first' },
        { id: 'msg-2', role: 'user', content: 'queued one', isQueued: true },
        { id: 'msg-3', role: 'user', content: 'queued two', isQueued: true },
      ])

      const event: InterruptedEvent = {
        type: 'interrupted',
        sessionId: 'session-1',
        message: { id: 'info-1', role: 'info', content: 'Response interrupted', timestamp: 0 } as any,
        queuedMessages: ['queued one', 'queued two'],
      }

      const next = handleInterrupted(state, event)

      // queued bubbles dropped
      const ids = next.state.session.messages.map(m => m.id)
      expect(ids).not.toContain('msg-2')
      expect(ids).not.toContain('msg-3')
      // info message appended
      expect(ids).toContain('info-1')
      // restore_input effect emitted with combined text
      expect(next.effects).toEqual([
        { type: 'restore_input', text: 'queued one\n\nqueued two' },
      ])
      // isProcessing cleared
      expect(next.state.session.isProcessing).toBe(false)
    })

    it('still works when no queued bubbles exist', () => {
      const state = makeState([
        { id: 'msg-1', role: 'user', content: 'first' },
      ])
      const event: InterruptedEvent = {
        type: 'interrupted',
        sessionId: 'session-1',
        message: { id: 'info-1', role: 'info', content: 'Response interrupted', timestamp: 0 } as any,
      }

      const next = handleInterrupted(state, event)
      expect(next.effects).toEqual([])
      expect(next.state.session.messages.map(m => m.id)).toContain('info-1')
    })
  })

  describe('silent redirect (event.message absent)', () => {
    it('keeps queued messages for auto-replay and does NOT emit restore_input (#616 fix)', () => {
      const state = makeState([
        { id: 'msg-1', role: 'user', content: 'first' },
        { id: 'msg-2', role: 'user', content: 'queued during run', isQueued: true },
      ])

      const event: InterruptedEvent = {
        type: 'interrupted',
        sessionId: 'session-1',
        // no message field — silent redirect
        queuedMessages: ['queued during run'],
      }

      const next = handleInterrupted(state, event)

      // queued message remains in session state; the input queue preview renders it.
      const ids = next.state.session.messages.map(m => m.id)
      expect(ids).toContain('msg-2')
      // no info bubble appended
      expect(ids).not.toContain('info-1')
      // critically: no restore_input effect — backend will auto-replay
      expect(next.effects).toEqual([])
      // isProcessing still gets cleared
      expect(next.state.session.isProcessing).toBe(false)
    })

    it('keeps the session processing during a queued send-now handoff', () => {
      const state = makeState([
        { id: 'msg-1', role: 'user', content: 'first' },
        { id: 'msg-2', role: 'user', content: 'queued during run', isQueued: true },
      ])

      const event: InterruptedEvent = {
        type: 'interrupted',
        sessionId: 'session-1',
        reason: 'queued_handoff',
      } as InterruptedEvent

      const next = handleInterrupted(state, event)

      expect(next.state.session.messages.map(m => m.id)).toContain('msg-2')
      expect(next.effects).toEqual([])
      expect(next.state.session.isProcessing).toBe(true)
    })

    it('marks running tools as interrupted regardless of redirect type', () => {
      const state = makeState([
        { id: 'tool-1', role: 'tool', toolStatus: 'executing', toolResult: undefined },
      ])
      const event: InterruptedEvent = {
        type: 'interrupted',
        sessionId: 'session-1',
      }

      const next = handleInterrupted(state, event)
      const tool = next.state.session.messages[0] as any
      expect(tool.toolStatus).toBe('error')
      expect(tool.toolResult).toBe('Interrupted')
      expect(tool.isError).toBe(true)
    })
  })

  it('always strips transient status messages', () => {
    const state = makeState([
      { id: 'msg-1', role: 'user', content: 'hi' },
      { id: 'status-1', role: 'status', content: 'thinking…' },
    ])
    const event: InterruptedEvent = {
      type: 'interrupted',
      sessionId: 'session-1',
    }

    const next = handleInterrupted(state, event)
    const ids = next.state.session.messages.map(m => m.id)
    expect(ids).not.toContain('status-1')
    expect(ids).toContain('msg-1')
  })

  it('normalizes interrupted messages without filter/map passes', () => {
    const messages = new Proxy([
      { id: 'msg-1', role: 'user', content: 'first' },
      { id: 'status-1', role: 'status', content: 'thinking' },
      { id: 'queued-1', role: 'user', content: 'queued', isQueued: true },
      { id: 'tool-1', role: 'tool', toolStatus: 'executing', toolResult: undefined },
      { id: 'assistant-1', role: 'assistant', content: 'partial', isPending: true, isStreaming: true },
    ] as any[], {
      get(target, prop, receiver) {
        if (prop === 'filter' || prop === 'map') {
          throw new Error('interrupted handler should normalize transcript in one pass')
        }
        return Reflect.get(target, prop, receiver)
      },
    })
    const state = makeState(messages)
    const event: InterruptedEvent = {
      type: 'interrupted',
      sessionId: 'session-1',
      message: { id: 'info-1', role: 'info', content: 'Response interrupted', timestamp: 0 } as any,
      queuedMessages: ['queued'],
    }

    const next = handleInterrupted(state, event)

    expect(next.state.session.messages.map(m => m.id)).toEqual(['msg-1', 'tool-1', 'assistant-1', 'info-1'])
    expect(next.state.session.messages[1]).toMatchObject({ toolStatus: 'error', toolResult: 'Interrupted', isError: true })
    expect(next.state.session.messages[2]).toMatchObject({ isPending: false, isStreaming: false })
  })
})

describe('queued message preview events', () => {
  it('removes a queued user message by id', () => {
    const state = makeState([
      { id: 'msg-1', role: 'user', content: 'first' },
      { id: 'msg-2', role: 'user', content: 'queued one', isQueued: true },
      { id: 'msg-3', role: 'user', content: 'queued two', isQueued: true },
    ])

    const next = processEvent(state, {
      type: 'queued_message_removed',
      sessionId: 'session-1',
      messageId: 'msg-2',
    } as any)

    expect(next.state.session.messages.map(m => m.id)).toEqual(['msg-1', 'msg-3'])
    expect(next.effects).toEqual([])
  })
})

describe('handleUserMessage queued state', () => {
  it('ignores duplicate accepted confirmations for an already confirmed user message', () => {
    const state = makeState([
      { id: 'msg-1', role: 'user', content: 'already accepted', timestamp: 1000, isPending: false, isQueued: false },
    ])
    state.session.lastMessageAt = 1234
    state.session.lastMessageRole = 'user'

    const event: UserMessageEvent = {
      type: 'user_message',
      sessionId: 'session-1',
      status: 'accepted',
      message: {
        id: 'msg-1',
        role: 'user',
        content: 'already accepted',
        timestamp: 1001,
      } as any,
    }

    const next = handleUserMessage(state, event)

    expect(next.state).toBe(state)
    expect(next.state.session.messages).toBe(state.session.messages)
    expect(next.state.session.lastMessageAt).toBe(1234)
  })

  it('moves a pending optimistic user message into the queue preview when the backend confirms queued', () => {
    const state = makeState([
      { id: 'optimistic-1', role: 'user', content: 'queued next', timestamp: 1000, isPending: true, isQueued: false },
    ])

    const event: UserMessageEvent = {
      type: 'user_message',
      sessionId: 'session-1',
      status: 'queued',
      optimisticMessageId: 'optimistic-1',
      message: {
        id: 'optimistic-1',
        role: 'user',
        content: 'queued next',
        timestamp: 1001,
      } as any,
    }

    const next = handleUserMessage(state, event)

    expect(next.state.session.messages).toHaveLength(1)
    expect(next.state.session.messages[0]?.isPending).toBe(false)
    expect(next.state.session.messages[0]?.isQueued).toBe(true)
    expect(next.state.session.isProcessing).toBe(true)
  })

  it('updates the matched optimistic user message without mapping the full transcript', () => {
    const messages = new Proxy([
      { id: 'optimistic-1', role: 'user', content: 'queued next', timestamp: 1000, isPending: true, isQueued: false },
      { id: 'assistant-1', role: 'assistant', content: 'working', timestamp: 1001 },
    ] as any[], {
      get(target, prop, receiver) {
        if (prop === 'map') {
          throw new Error('matched user_message update should not map the full transcript')
        }
        return Reflect.get(target, prop, receiver)
      },
    })
    const state = makeState(messages)

    const event: UserMessageEvent = {
      type: 'user_message',
      sessionId: 'session-1',
      status: 'queued',
      optimisticMessageId: 'optimistic-1',
      message: {
        id: 'optimistic-1',
        role: 'user',
        content: 'queued next',
        timestamp: 1001,
      } as any,
    }

    const next = handleUserMessage(state, event)

    expect(next.state.session.messages[0]?.isPending).toBe(false)
    expect(next.state.session.messages[0]?.isQueued).toBe(true)
    expect(next.state.session.messages[1]).toBe(messages[1])
  })

  it('keeps the active turn processing when a mid-stream message is queued', () => {
    const state = makeState([
      { id: 'msg-1', role: 'user', content: 'first' },
      { id: 'assistant-1', role: 'assistant', content: 'working', isStreaming: true },
    ])

    const event: UserMessageEvent = {
      type: 'user_message',
      sessionId: 'session-1',
      status: 'queued',
      message: {
        id: 'msg-2',
        role: 'user',
        content: 'queued next',
        timestamp: 1,
      },
    }

    const next = handleUserMessage(state, event)

    expect(next.state.session.isProcessing).toBe(true)
    expect(next.state.session.messages.find(m => m.id === 'msg-2')?.isQueued).toBe(true)
  })
})
