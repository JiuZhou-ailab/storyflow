import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { handleTextComplete } from '../text'
import type { SessionState, TextCompleteEvent } from '../../types'

const textHandlerSource = readFileSync(new URL('../text.ts', import.meta.url), 'utf8')

function makeState(messages: any[]): SessionState {
  return {
    session: {
      id: 'session-1',
      messages,
      lastMessageAt: Date.now(),
    } as any,
    streaming: null,
  }
}

describe('handleTextComplete messageId synchronization', () => {
  it('locates text_complete target with a single reverse scan', () => {
    const functionStart = textHandlerSource.indexOf('export function handleTextComplete(')
    const functionEnd = textHandlerSource.indexOf('// Message not found - CREATE IT', functionStart)
    const completeSource = textHandlerSource.slice(functionStart, functionEnd)

    expect(textHandlerSource).toContain('function findTextCompleteMessage')
    expect(completeSource).not.toContain('findStreamingMessage(session.messages, event.turnId)')
    expect(completeSource).not.toContain('findAssistantMessage(session.messages, event.turnId)')
  })

  it('overwrites existing streaming message id with authoritative messageId', () => {
    const state = makeState([
      {
        id: 'msg-local-temp-1',
        role: 'assistant',
        content: 'partial',
        isStreaming: true,
        isPending: true,
        turnId: 'turn-1',
        timestamp: 100,
      },
    ])

    const event: TextCompleteEvent = {
      type: 'text_complete',
      sessionId: 'session-1',
      text: 'final response',
      turnId: 'turn-1',
      messageId: 'msg-main-1',
      timestamp: 200,
    }

    const next = handleTextComplete(state, event)
    const msg = next.session.messages[0] as any

    expect(msg.id).toBe('msg-main-1')
    expect(msg.content).toBe('final response')
    expect(msg.isStreaming).toBe(false)
    expect(msg.isPending).toBe(false)
    expect(msg.timestamp).toBe(200)
  })

  it('uses authoritative messageId when creating message in race path', () => {
    const state = makeState([])

    const event: TextCompleteEvent = {
      type: 'text_complete',
      sessionId: 'session-1',
      text: 'created from complete',
      turnId: 'turn-race',
      messageId: 'msg-main-race',
      timestamp: 300,
    }

    const next = handleTextComplete(state, event)
    expect(next.session.messages).toHaveLength(1)
    expect((next.session.messages[0] as any).id).toBe('msg-main-race')
  })

  it('stores authoritative branchability metadata from text_complete events', () => {
    const state = makeState([
      {
        id: 'msg-local-temp-1',
        role: 'assistant',
        content: 'partial',
        isStreaming: true,
        isPending: true,
        turnId: 'turn-1',
        timestamp: 100,
      },
    ])

    const event: TextCompleteEvent = {
      type: 'text_complete',
      sessionId: 'session-1',
      text: 'final response',
      turnId: 'turn-1',
      messageId: 'msg-main-1',
      timestamp: 200,
      canBranch: false,
    }

    const next = handleTextComplete(state, event)

    expect((next.session.messages[0] as any).canBranch).toBe(false)
  })

  it('uses existing streaming message content before stale streaming state for empty text_complete', () => {
    const state: SessionState = {
      session: {
        id: 'session-1',
        messages: [
          {
            id: 'msg-local-temp-1',
            role: 'assistant',
            content: 'hello world',
            isStreaming: true,
            isPending: true,
            turnId: 'turn-1',
            timestamp: 100,
          },
        ],
        lastMessageAt: Date.now(),
      } as any,
      streaming: {
        content: 'hello',
        turnId: 'turn-1',
      },
    }

    const event: TextCompleteEvent = {
      type: 'text_complete',
      sessionId: 'session-1',
      text: '',
      turnId: 'turn-1',
      messageId: 'msg-main-1',
      timestamp: 200,
    }

    const next = handleTextComplete(state, event)

    expect((next.session.messages[0] as any).content).toBe('hello world')
  })

  it('prefers matching streaming turn before newer unrelated streaming fallback', () => {
    const state = makeState([
      {
        id: 'msg-turn-1',
        role: 'assistant',
        content: 'target partial',
        isStreaming: true,
        isPending: true,
        turnId: 'turn-1',
        timestamp: 100,
      },
      {
        id: 'msg-turn-2',
        role: 'assistant',
        content: 'other partial',
        isStreaming: true,
        isPending: true,
        turnId: 'turn-2',
        timestamp: 200,
      },
    ])
    const event: TextCompleteEvent = {
      type: 'text_complete',
      sessionId: 'session-1',
      text: 'target final',
      turnId: 'turn-1',
      messageId: 'msg-main-1',
      timestamp: 300,
    }

    const next = handleTextComplete(state, event)

    expect((next.session.messages[0] as any).id).toBe('msg-main-1')
    expect((next.session.messages[0] as any).content).toBe('target final')
    expect((next.session.messages[1] as any).id).toBe('msg-turn-2')
    expect((next.session.messages[1] as any).isStreaming).toBe(true)
  })

  it('keeps the original state for duplicate intermediate text_complete data', () => {
    const state = makeState([
      {
        id: 'msg-main-1',
        role: 'assistant',
        content: 'already complete',
        isStreaming: false,
        isPending: false,
        isIntermediate: true,
        turnId: 'turn-1',
        timestamp: 200,
      },
    ])

    const event: TextCompleteEvent = {
      type: 'text_complete',
      sessionId: 'session-1',
      text: 'already complete',
      turnId: 'turn-1',
      messageId: 'msg-main-1',
      timestamp: 200,
      isIntermediate: true,
    }

    expect(handleTextComplete(state, event)).toBe(state)
  })

  it('keeps backward compatibility when messageId is missing', () => {
    const state = makeState([])

    const event: TextCompleteEvent = {
      type: 'text_complete',
      sessionId: 'session-1',
      text: 'legacy payload',
      turnId: 'turn-legacy',
      timestamp: 400,
    }

    const next = handleTextComplete(state, event)
    const id = (next.session.messages[0] as any).id as string

    expect(id.startsWith('msg-')).toBe(true)
    expect(id).not.toBe('')
  })
})
