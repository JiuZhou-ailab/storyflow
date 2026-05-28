// input: message lookup helpers and synthetic transcript messages
// output: regression coverage for hot-path message lookup behavior
// pos: guards renderer event-processor helper behavior used by streaming handlers

import { describe, expect, it } from 'bun:test'
import type { Message } from '../../../../shared/types'
import {
  findAssistantMessage,
  findMessageByTurnId,
  findStreamingMessage,
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
})
