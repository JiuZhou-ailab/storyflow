// input: message lookup helpers and synthetic transcript messages
// output: regression coverage for hot-path message lookup behavior
// pos: guards renderer event-processor helper behavior used by streaming handlers

import { describe, expect, it } from 'bun:test'
import type { Message } from '../../../../shared/types'
import {
  findAssistantMessage,
  findMessageByTurnId,
  findStreamingMessage,
  findToolMessage,
  appendMessage,
  updateMessageAt,
} from '../../helpers'

function message(overrides: Partial<Message>): Message {
  return {
    id: overrides.id ?? 'm',
    role: overrides.role ?? 'assistant',
    content: overrides.content ?? '',
    timestamp: overrides.timestamp ?? 1,
    ...overrides,
  } as Message
}

describe('message lookup helpers', () => {
  it('prefers the latest matching turnId for streaming hot-path lookups', () => {
    const messages = [
      message({ id: 'old', turnId: 'turn-1', isStreaming: true }),
      message({ id: 'middle', turnId: 'turn-2', isStreaming: true }),
      message({ id: 'latest', turnId: 'turn-1', isStreaming: true }),
    ]

    expect(findStreamingMessage(messages, 'turn-1')).toBe(2)
    expect(findAssistantMessage(messages, 'turn-1')).toBe(2)
    expect(findMessageByTurnId(messages, 'turn-1', 'assistant')).toBe(2)
  })

  it('prefers the latest matching toolUseId for tool hot-path lookups', () => {
    const messages = [
      message({ id: 'old', role: 'tool', toolUseId: 'tool-1' }),
      message({ id: 'middle', role: 'tool', toolUseId: 'tool-2' }),
      message({ id: 'latest', role: 'tool', toolUseId: 'tool-1' }),
    ]

    expect(findToolMessage(messages, 'tool-1')).toBe(2)
  })

  it('keeps the original session reference for no-op message patches', () => {
    const existing = message({
      id: 'assistant-1',
      content: 'same',
      isStreaming: true,
    })
    const session = {
      id: 'session-1',
      messages: [existing],
      lastMessageAt: 1,
    } as any

    expect(updateMessageAt(session, 0, { content: 'same' })).toBe(session)
    expect(updateMessageAt(session, 0, { content: 'same' }, true)).not.toBe(session)
  })

  it('keeps append dedupe on by default and lets generated-id callers skip the scan', () => {
    const existing = message({ id: 'generated-1', content: 'first' })
    const session = {
      id: 'session-1',
      messages: [existing],
      lastMessageAt: 1,
    } as any

    expect(appendMessage(session, existing)).toBe(session)
    expect(appendMessage(session, existing, false, false).messages).toHaveLength(2)
  })
})
