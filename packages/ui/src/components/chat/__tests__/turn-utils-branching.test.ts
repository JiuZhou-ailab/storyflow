// input: Chat messages with and without provider-backed turn metadata
// output: Regression checks for response branchability metadata
// pos: Guards TurnCard branching affordances for local-only starter messages

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { groupMessagesByTurn } from '../turn-utils'
import type { Message } from '@craft-agent/core'

const turnUtilsSource = readFileSync(new URL('../turn-utils.ts', import.meta.url), 'utf8')

describe('groupMessagesByTurn branching metadata', () => {
  it('does not copy-sort messages that are already timestamp ordered', () => {
    const functionStart = turnUtilsSource.indexOf('export function groupMessagesByTurn(')
    const functionEnd = turnUtilsSource.indexOf('const turns: Turn[] = []', functionStart)
    const setupSource = turnUtilsSource.slice(functionStart, functionEnd)

    expect(setupSource).toContain('let isTimestampOrdered = true')
    expect(setupSource).not.toContain('const sortedMessages = [...messages].sort')
  })

  it('still sorts messages when timestamps arrive out of order', () => {
    const messages: Message[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Response',
        timestamp: 1100,
        turnId: 'turn-1',
      },
      {
        id: 'user-1',
        role: 'user',
        content: 'Prompt',
        timestamp: 1000,
      },
    ]

    const turns = groupMessagesByTurn(messages)

    expect(turns.map(turn => turn.type)).toEqual(['user', 'assistant'])
  })

  it('marks local assistant messages without provider turn IDs as not branchable', () => {
    const messages: Message[] = [{
      id: 'session-1-starter',
      role: 'assistant',
      content: 'Local starter content',
      timestamp: 1000,
    }]

    const turns = groupMessagesByTurn(messages)
    const assistantTurn = turns.find(turn => turn.type === 'assistant')

    expect(assistantTurn?.type).toBe('assistant')
    if (!assistantTurn || assistantTurn.type !== 'assistant') return
    expect(assistantTurn.response?.messageId).toBe('session-1-starter')
    expect(assistantTurn.response?.canBranch).toBe(false)
  })

  it('marks provider-backed assistant messages as branchable', () => {
    const messages: Message[] = [{
      id: 'assistant-1',
      role: 'assistant',
      content: 'Provider response',
      timestamp: 1000,
      turnId: 'turn-1',
    }]

    const turns = groupMessagesByTurn(messages)
    const assistantTurn = turns.find(turn => turn.type === 'assistant')

    expect(assistantTurn?.type).toBe('assistant')
    if (!assistantTurn || assistantTurn.type !== 'assistant') return
    expect(assistantTurn.response?.messageId).toBe('assistant-1')
    expect(assistantTurn.response?.canBranch).toBe(true)
  })

  it('respects explicit provider branchability metadata over turn IDs', () => {
    const messages: Message[] = [{
      id: 'assistant-1',
      role: 'assistant',
      content: 'Provider response missing a fork anchor',
      timestamp: 1000,
      turnId: 'turn-1',
      canBranch: false,
    }]

    const turns = groupMessagesByTurn(messages)
    const assistantTurn = turns.find(turn => turn.type === 'assistant')

    expect(assistantTurn?.type).toBe('assistant')
    if (!assistantTurn || assistantTurn.type !== 'assistant') return
    expect(assistantTurn.response?.messageId).toBe('assistant-1')
    expect(assistantTurn.response?.canBranch).toBe(false)
  })
})
