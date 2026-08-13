// input: Error events and synthetic session transcripts
// output: Regression coverage for error handler transcript update cost
// pos: Guards renderer error events against unnecessary full transcript mapping

import { describe, expect, it } from 'bun:test'
import { handleError, handleTypedError } from '../session'
import type { ErrorEvent, SessionState, TypedErrorEvent } from '../../types'

function makeState(messages: any[]): SessionState {
  return {
    session: {
      id: 'session-1',
      messages,
      isProcessing: true,
      currentStatus: { message: 'working', statusType: 'running' },
    } as any,
    streaming: null,
  }
}

describe('error handler fast path', () => {
  it('appends simple errors without mapping transcripts that have no running tools', () => {
    const messages = new Proxy([
      { id: 'msg-1', role: 'assistant', content: 'done' },
    ] as any[], {
      get(target, prop, receiver) {
        if (prop === 'map') {
          throw new Error('error append should not map when no running tools exist')
        }
        return Reflect.get(target, prop, receiver)
      },
    })
    const event: ErrorEvent = {
      type: 'error',
      sessionId: 'session-1',
      error: 'boom',
      timestamp: 123,
    }

    const next = handleError(makeState(messages), event)

    expect(next.state.session.messages).toHaveLength(2)
    expect(next.state.session.messages[0]).toBe(messages[0])
    expect(next.state.session.messages[1]?.role).toBe('error')
    expect(next.state.session.messages[1]?.content).toBe('boom')
  })

  it('appends typed errors without mapping transcripts that have no running tools', () => {
    const messages = new Proxy([
      { id: 'msg-1', role: 'assistant', content: 'done' },
    ] as any[], {
      get(target, prop, receiver) {
        if (prop === 'map') {
          throw new Error('typed error append should not map when no running tools exist')
        }
        return Reflect.get(target, prop, receiver)
      },
    })
    const event: TypedErrorEvent = {
      type: 'typed_error',
      sessionId: 'session-1',
      error: {
        code: 'service_error',
        title: 'Failed',
        message: 'boom',
        actions: [],
        canRetry: false,
      },
      timestamp: 123,
    }

    const next = handleTypedError(makeState(messages), event)

    expect(next.state.session.messages).toHaveLength(2)
    expect(next.state.session.messages[0]).toBe(messages[0])
    expect(next.state.session.messages[1]?.role).toBe('error')
    expect(next.state.session.messages[1]?.content).toBe('boom')
    expect(next.state.session.messages[1]?.errorTitle).toBe('Failed')
  })
})
