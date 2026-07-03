import { describe, expect, it } from 'bun:test'
import { handleAsyncOperation, handleSessionModelChanged } from './session'
import type { AsyncOperationEvent, SessionModelChangedEvent, SessionState } from '../types'

function makeState(sessionFields: Record<string, unknown>): SessionState {
  return {
    session: {
      id: 'session-1',
      messages: [],
      ...sessionFields,
    } as any,
    streaming: null,
  }
}

describe('session event no-op guards', () => {
  it('keeps the original state for duplicate async operation status', () => {
    const state = makeState({ isAsyncOperationOngoing: true })
    const event: AsyncOperationEvent = {
      type: 'async_operation',
      sessionId: 'session-1',
      isOngoing: true,
    }

    expect(handleAsyncOperation(state, event).state).toBe(state)
  })

  it('keeps the original state for duplicate session model', () => {
    const state = makeState({ model: 'gpt-5' })
    const event: SessionModelChangedEvent = {
      type: 'session_model_changed',
      sessionId: 'session-1',
      model: 'gpt-5',
    }

    expect(handleSessionModelChanged(state, event).state).toBe(state)
  })
})
