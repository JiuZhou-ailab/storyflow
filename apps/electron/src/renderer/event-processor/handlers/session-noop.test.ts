import { describe, expect, it } from 'bun:test'
import {
  handleAsyncOperation,
  handleConnectionChanged,
  handleLabelsChanged,
  handleNameChanged,
  handleSessionModelChanged,
  handleSessionStatusChanged,
  handleSourcesChanged,
  handleTitleRegenerating,
  handleWorkingDirectoryChanged,
} from './session'
import type {
  AsyncOperationEvent,
  LabelsChangedEvent,
  LLMConnectionChangedEvent,
  NameChangedEvent,
  SessionModelChangedEvent,
  SessionStatusChangedEvent,
  SessionState,
  SourcesChangedEvent,
  TitleRegeneratingEvent,
  WorkingDirectoryChangedEvent,
} from '../types'

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

  it('keeps the original state for duplicate connection capabilities', () => {
    const state = makeState({ llmConnection: 'codex', supportsBranching: true })
    const event: LLMConnectionChangedEvent = {
      type: 'connection_changed',
      sessionId: 'session-1',
      connectionSlug: 'codex',
      supportsBranching: true,
    }

    expect(handleConnectionChanged(state, event).state).toBe(state)
  })

  it('keeps the original state for duplicate session status', () => {
    const state = makeState({ sessionStatus: 'drafting' })
    const event: SessionStatusChangedEvent = {
      type: 'session_status_changed',
      sessionId: 'session-1',
      sessionStatus: 'drafting',
    }

    expect(handleSessionStatusChanged(state, event).state).toBe(state)
  })

  it('keeps the original state for duplicate labels', () => {
    const state = makeState({ labels: ['draft', 'urgent'] })
    const event: LabelsChangedEvent = {
      type: 'labels_changed',
      sessionId: 'session-1',
      labels: ['draft', 'urgent'],
    }

    expect(handleLabelsChanged(state, event).state).toBe(state)
  })

  it('keeps the original state for duplicate enabled sources', () => {
    const state = makeState({ enabledSourceSlugs: ['github', 'docs'] })
    const event: SourcesChangedEvent = {
      type: 'sources_changed',
      sessionId: 'session-1',
      enabledSourceSlugs: ['github', 'docs'],
    }

    expect(handleSourcesChanged(state, event).state).toBe(state)
  })

  it('keeps the original state for duplicate session name', () => {
    const state = makeState({ name: 'Draft title' })
    const event: NameChangedEvent = {
      type: 'name_changed',
      sessionId: 'session-1',
      name: 'Draft title',
    }

    expect(handleNameChanged(state, event).state).toBe(state)
  })

  it('keeps the original state for duplicate title regeneration status', () => {
    const state = makeState({ isRegeneratingTitle: true })
    const event: TitleRegeneratingEvent = {
      type: 'title_regenerating',
      sessionId: 'session-1',
      isRegenerating: true,
    }

    expect(handleTitleRegenerating(state, event).state).toBe(state)
  })

  it('keeps the original state for duplicate working directory', () => {
    const state = makeState({ workingDirectory: '/repo/project' })
    const event: WorkingDirectoryChangedEvent = {
      type: 'working_directory_changed',
      sessionId: 'session-1',
      workingDirectory: '/repo/project',
    }

    expect(handleWorkingDirectoryChanged(state, event).state).toBe(state)
  })
})
