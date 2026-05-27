// input: Chat messages with and without provider-backed turn metadata
// output: Regression checks for response branchability metadata
// pos: Guards TurnCard branching affordances for local-only starter messages

import { describe, expect, it } from 'bun:test'
import { groupMessagesByTurn } from '../turn-utils'
import type { Message } from '@craft-agent/core'

describe('groupMessagesByTurn branching metadata', () => {
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
