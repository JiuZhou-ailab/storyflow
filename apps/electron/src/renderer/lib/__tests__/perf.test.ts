// input: renderer performance helper functions
// output: regression coverage for low-overhead renderer profiling metadata
// pos: guards debug-only renderer perf instrumentation helpers

import { describe, expect, it } from 'bun:test'
import { summarizeNovelDocumentPerfEvent, summarizeTextDeltaPerfEvent } from '../perf'

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

  it('summarizes writing document profiling metadata without exposing full paths', () => {
    expect(summarizeNovelDocumentPerfEvent({
      filePath: '/novel/正文/01.md',
      phase: 'readFile',
      durationMs: 12.6,
      contentLength: 2400,
    })).toEqual({
      fileName: '01.md',
      phase: 'readFile',
      durationMs: 13,
      contentLength: 2400,
    })
  })
})
