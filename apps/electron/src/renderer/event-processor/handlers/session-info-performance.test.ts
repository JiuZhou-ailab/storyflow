// input: Session info events and handler source
// output: Regression coverage for compacting-status update performance
// pos: Guards info event handling against avoidable repeated message scans

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { handleInfo } from './session'
import type { InfoEvent, SessionState } from '../types'

const sessionHandlerSource = readFileSync(new URL('./session.ts', import.meta.url), 'utf8')

function makeState(messages: any[]): SessionState {
  return {
    session: {
      id: 'session-1',
      messages,
      currentStatus: { message: 'Compacting...', statusType: 'compacting' },
    } as any,
    streaming: null,
  }
}

describe('handleInfo performance contracts', () => {
  it('updates all compacting status messages for compaction completion', () => {
    const state = makeState([
      { id: 'status-1', role: 'status', content: 'Compacting...', statusType: 'compacting', timestamp: 1 },
      { id: 'msg-1', role: 'user', content: 'hello', timestamp: 2 },
      { id: 'status-2', role: 'status', content: 'Compacting...', statusType: 'compacting', timestamp: 3 },
    ])
    const event: InfoEvent = {
      type: 'info',
      sessionId: 'session-1',
      message: 'Compaction complete',
      statusType: 'compaction_complete',
      level: 'success',
    }

    const next = handleInfo(state, event)

    expect(next.state.session.currentStatus).toBeUndefined()
    expect(next.state.session.messages).toEqual([
      { id: 'status-1', role: 'info', content: 'Compaction complete', statusType: 'compaction_complete', timestamp: 1, infoLevel: 'success' },
      { id: 'msg-1', role: 'user', content: 'hello', timestamp: 2 },
      { id: 'status-2', role: 'info', content: 'Compaction complete', statusType: 'compaction_complete', timestamp: 3, infoLevel: 'success' },
    ])
  })

  it('does not pre-scan messages before updating compacting status messages', () => {
    const branchStart = sessionHandlerSource.indexOf("if (event.statusType === 'compaction_complete')")
    const branchEnd = sessionHandlerSource.indexOf('// Otherwise, add as new info message', branchStart)
    const compactionBranch = sessionHandlerSource.slice(branchStart, branchEnd)

    expect(compactionBranch).not.toContain('session.messages.some')
    expect(compactionBranch).not.toContain('session.messages.map')
  })
})
