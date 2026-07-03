import { describe, expect, it } from 'bun:test'
import { handleAsyncOperation } from './session'
import type { AsyncOperationEvent, SessionState } from '../types'

function makeState(isAsyncOperationOngoing: boolean): SessionState {
  return {
    session: {
      id: 'session-1',
      messages: [],
      isAsyncOperationOngoing,
    } as any,
    streaming: null,
  }
}

describe('session event no-op guards', () => {
  it('keeps the original state for duplicate async operation status', () => {
    const state = makeState(true)
    const event: AsyncOperationEvent = {
      type: 'async_operation',
      sessionId: 'session-1',
      isOngoing: true,
    }

    expect(handleAsyncOperation(state, event).state).toBe(state)
  })
})
