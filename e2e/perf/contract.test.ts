// input: Representative valid and invalid perf configurations and metric sets
// output: Regression assertions for fail-closed local performance baseline decisions
// pos: Guards the perf runner from silent scenario skips and vacuous success

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'
import {
  buildSizeAwareRing,
  buildSwitchRing,
  evaluateMeasuredBaselines,
  parsePerfScenarios,
  parsePositiveInteger,
  percentile,
  LARGE_SESSION_MESSAGES,
} from './contract'

const perfRunnerSource = readFileSync(new URL('./run.ts', import.meta.url), 'utf-8')

describe('perf harness contract', () => {
  it('fails startup when the writing route mounts the legacy conversation UI', () => {
    expect(perfRunnerSource).toContain('[data-tutorial="chat-history"]')
    expect(perfRunnerSource).toContain('[data-tutorial="new-session-button"]')
    expect(perfRunnerSource).toContain('Writing project entry mounted the legacy conversation UI')
  })

  it('rejects empty, unknown, and duplicate scenarios', () => {
    expect(() => parsePerfScenarios('startup,')).toThrow('empty scenario')
    expect(() => parsePerfScenarios('startup,leak')).toThrow('Unknown PERF_SCENARIOS: leak')
    expect(() => parsePerfScenarios('startup,startup')).toThrow('duplicates')
  })

  it('rejects non-positive and malformed sample counts', () => {
    expect(() => parsePositiveInteger('0', 3, 'PERF_STARTUP_RUNS')).toThrow('positive integer')
    expect(() => parsePositiveInteger('-1', 3, 'PERF_STARTUP_RUNS')).toThrow('positive integer')
    expect(() => parsePositiveInteger('1.5', 3, 'PERF_STARTUP_RUNS')).toThrow('positive integer')
  })

  it('fails closed when metrics are empty, missing, or over budget', () => {
    expect(evaluateMeasuredBaselines(['startup'], [])).toEqual({ coveragePass: false, selectedPass: false })
    expect(evaluateMeasuredBaselines(['switch'], [
      { scenario: 'switch', pass: true },
    ])).toEqual({ coveragePass: false, selectedPass: false })
    expect(evaluateMeasuredBaselines(['startup'], [
      { scenario: 'startup', pass: true },
      { scenario: 'startup', pass: true },
      { scenario: 'startup', pass: false },
    ])).toEqual({ coveragePass: true, selectedPass: false })
  })

  it('passes only when every selected measured baseline is present and within budget', () => {
    expect(evaluateMeasuredBaselines(['startup', 'switch'], [
      { scenario: 'startup', pass: true },
      { scenario: 'startup', pass: true },
      { scenario: 'startup', pass: true },
      { scenario: 'switch', pass: true },
      { scenario: 'switch', pass: true },
      { scenario: 'switch', pass: true },
    ])).toEqual({ coveragePass: true, selectedPass: true })
  })

  it('requires the large-session switch metric, not just the aggregate pair', () => {
    // switch reports app-instrumented + wall-clock + large-session wall-clock.
    // Dropping the size-sensitive one must fail coverage rather than pass quietly.
    expect(evaluateMeasuredBaselines(['switch'], [
      { scenario: 'switch', pass: true },
      { scenario: 'switch', pass: true },
    ])).toEqual({ coveragePass: false, selectedPass: false })
  })

  it('orders switch rings largest-transcript-first so large sessions are always visited', () => {
    const sessions = [
      { id: 'small-a', messageCount: 12 },
      { id: 'huge', messageCount: 1000 },
      { id: 'small-b', messageCount: 28 },
      { id: 'mid', messageCount: 300 },
    ]
    // A ring smaller than the session set must still contain the largest transcript;
    // arbitrary slicing is what made the old P95 size-blind.
    expect(buildSizeAwareRing(sessions, 2)).toEqual(['huge', 'mid'])
    expect(buildSizeAwareRing(sessions, 10)).toEqual(['huge', 'mid', 'small-b', 'small-a'])
  })

  it('breaks ring ties deterministically and rejects unusable inputs', () => {
    const tied = [
      { id: 'b', messageCount: 50 },
      { id: 'a', messageCount: 50 },
    ]
    expect(buildSizeAwareRing(tied, 2)).toEqual(['a', 'b'])
    expect(() => buildSizeAwareRing([], 4)).toThrow('zero sessions')
    expect(() => buildSizeAwareRing(tied, 0)).toThrow('positive')
  })

  it('does not let a single outlier become the reported P95', () => {
    // Nearest-rank made P95 == max() for n <= 20, so one hiccup in a 20-sample
    // switch run decided pass/fail (same build measured 84ms and 169ms).
    const oneSpike = [...Array(19).fill(50), 500]
    expect(percentile(oneSpike, 0.95)).toBeLessThan(500)
    expect(percentile(oneSpike, 0.95)).toBeLessThan(100)
    // Still tracks a genuinely slow tail rather than hiding it.
    const manySlow = [...Array(10).fill(50), ...Array(10).fill(500)]
    expect(percentile(manySlow, 0.95)).toBeGreaterThan(400)
  })

  it('computes percentiles over known distributions', () => {
    expect(percentile([10], 0.95)).toBe(10)
    expect(percentile([], 0.95)).toBeNaN()
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3)
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(percentile([0, 100], 0.95)).toBe(95)
  })

  it('keeps the large-session threshold below the fixture long session', () => {
    // generate-fixture.ts writes one 1000-message session per workspace.
    expect(LARGE_SESSION_MESSAGES).toBeLessThanOrEqual(1000)
    // ...and above the fixture's ~28-message median, or every session counts as large.
    expect(LARGE_SESSION_MESSAGES).toBeGreaterThan(280)
  })

  it('samples the lone large session repeatedly instead of once', () => {
    // Fixture shape: exactly one session over the threshold, many small ones.
    const sessions = [
      { id: 'huge', messageCount: 1000 },
      { id: 's1', messageCount: 20 },
      { id: 's2', messageCount: 30 },
      { id: 's3', messageCount: 40 },
    ]
    const ring = buildSwitchRing(sessions, 8)
    expect(ring.length).toBe(8)
    // A largest-first ring would contain 'huge' once and report a 1-sample P95.
    expect(ring.filter(id => id === 'huge').length).toBe(4)
    // Never twice in a row, so each large switch is a real load, not a no-op reselect.
    for (let i = 1; i < ring.length; i++) expect(ring[i]).not.toBe(ring[i - 1])
  })

  it('falls back to plain ordering when the fixture has no size spread', () => {
    const allSmall = [
      { id: 'a', messageCount: 10 },
      { id: 'b', messageCount: 20 },
    ]
    expect(buildSwitchRing(allSmall, 2)).toEqual(['b', 'a'])
    expect(() => buildSwitchRing([], 2)).toThrow('zero sessions')
  })

  it('accepts heavy interaction scenarios with single-metric coverage', () => {
    expect(evaluateMeasuredBaselines(['heavy-writing', 'heavy-search'], [
      { scenario: 'heavy-writing', pass: true },
      { scenario: 'heavy-search', pass: true },
    ])).toEqual({ coveragePass: true, selectedPass: true })
  })

  it('accepts continuous typing and document-leak scenarios', () => {
    expect(evaluateMeasuredBaselines(['continuous-typing', 'memory-leak-docs'], [
      { scenario: 'continuous-typing', pass: true },
      { scenario: 'memory-leak-docs', pass: true },
    ])).toEqual({ coveragePass: true, selectedPass: true })
  })
})
