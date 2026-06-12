// input: Mock backend compaction capability and session turn counters
// output: Proactive auto-compaction lifecycle contract tests
// pos: Guards the server-core lifecycle module used by SessionManager before each user turn

import { describe, expect, it, mock } from 'bun:test'
import { DEFAULT_AUTO_COMPACT_START_USER_ITERATION } from '@craft-agent/shared/agent'
import { AUTO_COMPACT_CONTEXT_INSTRUCTIONS, runAutoCompactBeforeTurn } from './auto-compact-lifecycle'

function createHarness(overrides: {
  compactContext?: (instructions?: string) => Promise<{ tokensBefore?: number } | null>
  sessionId?: string | null
} = {}) {
  const infoCalls: Array<[string, Record<string, unknown> | undefined]> = []
  const warnCalls: string[] = []
  const marks: string[] = []
  const compactContext = mock(overrides.compactContext ?? (async () => ({ tokensBefore: 120_000 })))

  return {
    agent: {
      compactContext,
      getSessionId: () => overrides.sessionId ?? 'provider-session',
    },
    log: {
      info: (message: string, data?: Record<string, unknown>) => {
        infoCalls.push([message, data])
      },
      warn: (message: string) => {
        warnCalls.push(message)
      },
    },
    span: {
      mark: (label: string) => {
        marks.push(label)
      },
    },
    compactContext,
    infoCalls,
    warnCalls,
    marks,
  }
}

describe('runAutoCompactBeforeTurn', () => {
  it('does not compact before the start threshold', async () => {
    const harness = createHarness()

    const result = await runAutoCompactBeforeTurn({
      sessionId: 'session-1',
      userIteration: DEFAULT_AUTO_COMPACT_START_USER_ITERATION - 1,
      agent: harness.agent,
      log: harness.log,
      span: harness.span,
    })

    expect(result.compacted).toBe(false)
    expect(result.reason).toBe('below start threshold')
    expect(harness.compactContext).not.toHaveBeenCalled()
    expect(harness.marks).toEqual([])
  })

  it('compacts and returns the next marker when policy allows it', async () => {
    const harness = createHarness()

    const result = await runAutoCompactBeforeTurn({
      sessionId: 'session-1',
      userIteration: DEFAULT_AUTO_COMPACT_START_USER_ITERATION,
      agent: harness.agent,
      log: harness.log,
      span: harness.span,
    })

    expect(result.compacted).toBe(true)
    expect(result.nextLastCompactedUserIteration).toBe(DEFAULT_AUTO_COMPACT_START_USER_ITERATION)
    expect(result.tokensBefore).toBe(120_000)
    expect(harness.compactContext).toHaveBeenCalledWith(AUTO_COMPACT_CONTEXT_INSTRUCTIONS)
    expect(harness.marks).toEqual(['autoCompact.starting', 'autoCompact.complete'])
    expect(harness.infoCalls.map(([message]) => message)).toEqual([
      'Auto-compacting provider context before user turn',
      'Auto-compacted provider context',
    ])
  })

  it('logs failure without blocking the turn', async () => {
    const harness = createHarness({
      compactContext: async () => {
        throw new Error('provider rejected compaction')
      },
    })

    const result = await runAutoCompactBeforeTurn({
      sessionId: 'session-1',
      userIteration: DEFAULT_AUTO_COMPACT_START_USER_ITERATION,
      agent: harness.agent,
      log: harness.log,
      span: harness.span,
    })

    expect(result.compacted).toBe(false)
    expect(result.nextLastCompactedUserIteration).toBeUndefined()
    expect(harness.marks).toEqual(['autoCompact.starting', 'autoCompact.failed'])
    expect(harness.warnCalls).toEqual([
      'Auto-compaction failed for session session-1: provider rejected compaction',
    ])
  })
})
