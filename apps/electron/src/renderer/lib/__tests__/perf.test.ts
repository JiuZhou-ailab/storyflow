// input: renderer performance helper functions
// output: regression coverage for low-overhead renderer profiling metadata
// pos: guards debug-only renderer perf instrumentation helpers

import { describe, expect, it } from 'bun:test'
import { summarizeTextDeltaPerfEvent } from '../perf'

describe('renderer perf helpers', () => {
  it('summarizes text delta profiling metadata without reading UI state', () => {
    expect(summarizeTextDeltaPerfEvent({
      sessionId: 'session-123456789',
      delta: 'hello',
    })).toEqual({
      sessionId: 'session-123456789',
      deltaLength: 5,
    })
  })
})
