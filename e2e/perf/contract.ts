// input: Performance harness environment values, selected scenarios, and measured metrics
// output: Strict configuration parsing and fail-closed baseline coverage decisions
// pos: Pure acceptance boundary shared by the local perf runner and its regression tests

export const PERF_SCENARIOS = [
  'startup',
  'switch',
  'memory-steady',
  'memory-leak',
  'memory-leak-docs',
  'heavy-writing',
  'heavy-search',
  'continuous-typing',
] as const
export type PerfScenario = typeof PERF_SCENARIOS[number]

export interface PerfMetricLike {
  scenario: string
  pass: boolean
}

const EXPECTED_METRICS: Record<PerfScenario, number> = {
  startup: 3,
  switch: 2,
  'memory-steady': 1,
  'memory-leak': 1,
  'memory-leak-docs': 1,
  'heavy-writing': 1,
  'heavy-search': 1,
  'continuous-typing': 1,
}

export function parsePerfScenarios(raw: string | undefined): PerfScenario[] {
  const values = (raw ?? PERF_SCENARIOS.join(','))
    .split(',')
    .map(value => value.trim())

  if (values.some(value => value.length === 0)) {
    throw new Error('PERF_SCENARIOS must not contain empty scenario names')
  }

  const unknown = values.filter(value => !PERF_SCENARIOS.includes(value as PerfScenario))
  if (unknown.length > 0) {
    throw new Error(`Unknown PERF_SCENARIOS: ${unknown.join(', ')}`)
  }

  if (new Set(values).size !== values.length) {
    throw new Error('PERF_SCENARIOS must not contain duplicates')
  }

  return values as PerfScenario[]
}

export function parsePositiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined) return fallback
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a positive integer`)

  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

export function evaluateMeasuredBaselines(
  scenarios: readonly PerfScenario[],
  metrics: readonly PerfMetricLike[],
): { coveragePass: boolean; selectedPass: boolean } {
  const coveragePass = scenarios.every(scenario => (
    metrics.filter(metric => metric.scenario === scenario).length === EXPECTED_METRICS[scenario]
  )) && metrics.every(metric => scenarios.includes(metric.scenario as PerfScenario))

  return {
    coveragePass,
    selectedPass: coveragePass && metrics.length > 0 && metrics.every(metric => metric.pass),
  }
}
