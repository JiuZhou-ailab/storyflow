// input: Final assistant messages with durable turn measurements
// output: Regression coverage for turn projection and exact duration formatting
// pos: Guards completed-turn observability at the shared transcript boundary

import { describe, expect, it } from 'bun:test'
import { messageToStored, storedToMessage, type Message } from '@craft-agent/core'
import { formatDuration, groupMessagesByTurn } from '../turn-utils'

describe('turn metrics', () => {
  it('projects persisted metrics onto the assistant turn', () => {
    const metrics = {
      durationMs: 125_000,
      usage: {
        inputTokens: 7_500,
        outputTokens: 1_000,
      },
    }
    const messages: Message[] = [
      { id: 'user-1', role: 'user', content: 'Analyze', timestamp: 1 },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Done',
        timestamp: 2,
        turnMetrics: metrics,
      },
    ]

    const assistantTurn = groupMessagesByTurn(messages).find(turn => turn.type === 'assistant')

    expect(assistantTurn?.metrics).toBe(metrics)
  })

  it('survives the message persistence round trip', () => {
    const message: Message = {
      id: 'assistant-1',
      role: 'assistant',
      content: 'Done',
      timestamp: 2,
      turnMetrics: {
        durationMs: 8_400,
        usage: { inputTokens: 2_000, outputTokens: 320 },
      },
    }

    expect(storedToMessage(messageToStored(message)).turnMetrics).toEqual(message.turnMetrics)
  })

  it('keeps completed durations precise beyond two minutes', () => {
    expect(formatDuration(125_000)).toBe('2m 5s')
    expect(formatDuration(3_723_000)).toBe('1h 2m 3s')
  })
})
