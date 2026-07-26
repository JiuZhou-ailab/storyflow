// input: renderer performance helper functions
// output: regression coverage for low-overhead renderer profiling metadata
// pos: guards debug-only renderer perf instrumentation helpers

import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import {
  cancelSessionSwitch,
  clearMetrics,
  endSessionSwitch,
  getRecentMetrics,
  initRendererPerf,
  markSessionSwitch,
  startSessionSwitch,
  summarizeNovelDocumentPerfEvent,
  summarizeTextDeltaPerfEvent,
} from '../perf'

afterEach(() => {
  clearMetrics()
  initRendererPerf(false)
})

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

  it('preserves the first interaction start and marks when the page ensures the same switch', () => {
    let now = 10
    const nowSpy = spyOn(performance, 'now').mockImplementation(() => now)
    initRendererPerf(true)

    startSessionSwitch('session-1')
    now = 40
    startSessionSwitch('session-1')
    now = 50
    markSessionSwitch('session-1', 'panel.mounted')
    now = 55
    markSessionSwitch('session-1', 'panel.mounted')
    now = 70
    expect(endSessionSwitch('session-1')).toBe(60)

    expect(getRecentMetrics()).toEqual([
      {
        sessionId: 'session-1',
        startTime: 10,
        marks: [{ name: 'panel.mounted', elapsed: 40 }],
        endTime: 70,
        duration: 60,
      },
    ])
    nowSpy.mockRestore()
  })

  it('drops failed switches instead of recording retry wait time', () => {
    initRendererPerf(true)
    startSessionSwitch('session-1')
    cancelSessionSwitch('session-1')

    expect(endSessionSwitch('session-1')).toBeNull()
    expect(getRecentMetrics()).toEqual([])
  })
})
