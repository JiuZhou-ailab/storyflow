// input: text_delta handler source and synthetic streaming session state
// output: regression coverage for the renderer streaming hot path
// pos: guards text_delta against unnecessary full-message scans on common append path

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { handleTextDelta } from '../text'
import type { SessionState, TextDeltaEvent } from '../../types'

const textHandlerSource = readFileSync(new URL('../text.ts', import.meta.url), 'utf-8')

function makeState(messages: any[]): SessionState {
  return {
    session: {
      id: 'session-1',
      messages,
      lastMessageAt: 1,
    } as any,
    streaming: {
      content: 'hello',
      turnId: 'turn-1',
    },
  }
}

describe('handleTextDelta streaming hot path', () => {
  it('checks the last streaming assistant message before scanning the full transcript', () => {
    expect(textHandlerSource).toContain('function getLastStreamingMessageIndex')
    expect(textHandlerSource).toContain('const lastStreamingIndex = getLastStreamingMessageIndex(session.messages, event.turnId)')
    expect(textHandlerSource).toContain('lastStreamingIndex === -1')
    expect(textHandlerSource).toContain('findStreamingMessage(session.messages, event.turnId)')
  })

  it('skips append duplicate scans for renderer-generated streaming message ids', () => {
    expect(textHandlerSource).toContain('appendMessage(session, newMessage, false, false)')
  })

  it('updates existing streaming text without the generic message updater', () => {
    const deltaUpdateSource = textHandlerSource.slice(
      textHandlerSource.indexOf('if (streamingIndex !== -1) {'),
      textHandlerSource.indexOf('// Accumulate in streaming state only for the race path without a message.')
    )

    expect(deltaUpdateSource).toContain('messages[streamingIndex] = {')
    expect(deltaUpdateSource).not.toContain('updateMessageAt(session, streamingIndex')
  })

  it('appends deltas to the last matching streaming assistant message', () => {
    const state = makeState([
      {
        id: 'user-1',
        role: 'user',
        content: 'prompt',
        timestamp: 1,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'hello',
        timestamp: 2,
        isStreaming: true,
        isPending: true,
        turnId: 'turn-1',
      },
    ])
    const event: TextDeltaEvent = {
      type: 'text_delta',
      sessionId: 'session-1',
      delta: ' world',
      turnId: 'turn-1',
    }

    const next = handleTextDelta(state, event)

    expect(next.session.messages).toHaveLength(2)
    expect((next.session.messages[1] as any).content).toBe('hello world')
    expect(next.streaming).toBe(state.streaming)
  })

  it('keeps the original state for empty text_delta data', () => {
    const state = makeState([
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'hello',
        timestamp: 2,
        isStreaming: true,
        isPending: true,
        turnId: 'turn-1',
      },
    ])
    const event: TextDeltaEvent = {
      type: 'text_delta',
      sessionId: 'session-1',
      delta: '',
      turnId: 'turn-1',
    }

    expect(handleTextDelta(state, event)).toBe(state)
  })
})
