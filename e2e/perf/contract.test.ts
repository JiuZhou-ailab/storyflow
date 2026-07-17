// input: Representative valid and invalid perf configurations and metric sets
// output: Regression assertions for fail-closed local performance baseline decisions
// pos: Guards the perf runner from silent scenario skips and vacuous success

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'
import {
  evaluateMeasuredBaselines,
  parsePerfScenarios,
  parsePositiveInteger,
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
    ])).toEqual({ coveragePass: true, selectedPass: true })
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
