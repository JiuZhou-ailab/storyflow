// input: Queued-message removal events and handler source
// output: Regression coverage for queued-message removal performance
// pos: Guards queued removal against avoidable repeated message scans

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { handleQueuedMessageRemoved } from './session'
import type { QueuedMessageRemovedEvent, SessionState } from '../types'

const sessionHandlerSource = readFileSync(new URL('./session.ts', import.meta.url), 'utf8')

function makeState(messages: any[]): SessionState {
  return {
    session: {
      id: 'session-1',
      messages,
    } as any,
    streaming: null,
  }
}

describe('handleQueuedMessageRemoved performance contracts', () => {
  it('removes only the targeted queued message', () => {
    const state = makeState([
      { id: 'msg-1', role: 'user', content: 'first', timestamp: 1 },
      { id: 'msg-2', role: 'user', content: 'queued one', isQueued: true, timestamp: 2 },
      { id: 'msg-3', role: 'user', content: 'queued two', isQueued: true, timestamp: 3 },
    ])
    const event: QueuedMessageRemovedEvent = {
      type: 'queued_message_removed',
      sessionId: 'session-1',
      messageId: 'msg-2',
    }

    const next = handleQueuedMessageRemoved(state, event)

    expect(next.state.session.messages.map(message => message.id)).toEqual(['msg-1', 'msg-3'])
  })

  it('does not pre-scan messages before removing a queued message', () => {
    const functionStart = sessionHandlerSource.indexOf('export function handleQueuedMessageRemoved(')
    const functionEnd = sessionHandlerSource.indexOf('/**\n * Handle sources_changed', functionStart)
    const queuedRemovalSource = sessionHandlerSource.slice(functionStart, functionEnd)

    expect(queuedRemovalSource).not.toContain('session.messages.some')
    expect(queuedRemovalSource).not.toContain('session.messages.filter')
  })
})
