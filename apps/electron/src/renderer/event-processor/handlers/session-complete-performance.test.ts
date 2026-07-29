// input: Complete events, message state, and handler source
// output: Regression coverage for complete-event message update performance
// pos: Guards complete handling against avoidable repeated message scans

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { handleComplete } from './session'
import type { CompleteEvent, SessionState } from '../types'

const sessionHandlerSource = readFileSync(new URL('./session.ts', import.meta.url), 'utf8')

function makeState(messages: any[]): SessionState {
  return {
    session: {
      id: 'session-1',
      messages,
      isProcessing: true,
      currentStatus: { message: 'Working...', statusType: 'processing' },
    } as any,
    streaming: { messageId: 'stream-1', text: 'partial' } as any,
  }
}

describe('handleComplete performance contracts', () => {
  it('completes foreground tools and clears queued users without touching genuine background tasks', () => {
    const state = makeState([
      { id: 'tool-1', role: 'tool', content: '', toolStatus: 'executing', timestamp: 1 },
      { id: 'tool-bg', role: 'tool', content: '', toolStatus: 'backgrounded', isBackground: true, taskId: 'task-1', timestamp: 2 },
      { id: 'user-1', role: 'user', content: 'queued', isQueued: true, timestamp: 3 },
      { id: 'tool-2', role: 'tool', content: '', toolStatus: 'error', toolResult: 'failed', timestamp: 4 },
    ])
    const event: CompleteEvent = {
      type: 'complete',
      sessionId: 'session-1',
    }

    const next = handleComplete(state, event)

    expect(next.state.session.messages).toEqual([
      { id: 'tool-1', role: 'tool', content: '', toolStatus: 'completed', toolResult: '', timestamp: 1 },
      { id: 'tool-bg', role: 'tool', content: '', toolStatus: 'backgrounded', isBackground: true, taskId: 'task-1', timestamp: 2 },
      { id: 'user-1', role: 'user', content: 'queued', isQueued: false, timestamp: 3 },
      { id: 'tool-2', role: 'tool', content: '', toolStatus: 'error', toolResult: 'failed', timestamp: 4 },
    ])
    expect(next.state.session.isProcessing).toBe(false)
    expect(next.state.session.currentStatus).toBeUndefined()
    expect(next.state.streaming).toBeNull()
  })

  it('attaches completed turn metrics in the same message pass', () => {
    const state = makeState([
      { id: 'assistant-1', role: 'assistant', content: 'done', timestamp: 1 },
      { id: 'assistant-2', role: 'assistant', content: 'older', timestamp: 2 },
    ])
    const metrics = {
      durationMs: 12_300,
      usage: { inputTokens: 1_500, outputTokens: 240 },
    }

    const next = handleComplete(state, {
      type: 'complete',
      sessionId: 'session-1',
      turnMetrics: [{ messageId: 'assistant-1', metrics }],
    })

    expect(next.state.session.messages[0]?.turnMetrics).toBe(metrics)
    expect(next.state.session.messages[1]).toBe(state.session.messages[1])
  })

  it('does not pre-scan messages before applying complete-event message updates', () => {
    const functionStart = sessionHandlerSource.indexOf('export function handleComplete(')
    const functionEnd = sessionHandlerSource.indexOf('/**\n * Handle error', functionStart)
    const completeSource = sessionHandlerSource.slice(functionStart, functionEnd)

    expect(completeSource).not.toContain('session.messages.some')
    expect(completeSource).not.toContain('session.messages.map')
    expect(completeSource).not.toContain('updatedMessages.some')
    expect(completeSource).not.toContain('updatedMessages.map')
  })
})
