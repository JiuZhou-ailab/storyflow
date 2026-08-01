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
  switch: 3,
  'memory-steady': 1,
  'memory-leak': 1,
  'memory-leak-docs': 1,
  'heavy-writing': 1,
  'heavy-search': 1,
  'continuous-typing': 1,
}

/**
 * Linear-interpolated percentile.
 *
 * Nearest-rank makes P95 identical to max() for any n <= 20
 * (index = min(n-1, floor(n*0.95))), so a single scheduling hiccup in a 20-sample
 * switch run decided pass/fail — the same build measured 84ms and 169ms.
 * Interpolating keeps one outlier from becoming the reported value; raising the
 * sample count is what actually buys tail resolution.
 */
export function percentile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return NaN
  const sorted = [...xs].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]
  const pos = (sorted.length - 1) * q
  const lower = Math.floor(pos)
  const upper = Math.min(sorted.length - 1, lower + 1)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (pos - lower)
}

/** Message count at or above which a fixture session counts as a large transcript. */
export const LARGE_SESSION_MESSAGES = 500

export interface SessionRef {
  id: string
  messageCount: number
}

/**
 * Orders a switch ring largest-transcript-first, then fills with the rest.
 *
 * The fixture holds one 1000-message session per workspace against a long tail whose
 * median is ~28 messages, so slicing ids in arbitrary order yields a ring that almost
 * never loads a large transcript and reports a size-blind P95.
 */
export function buildSizeAwareRing(sessions: readonly SessionRef[], size: number): string[] {
  if (size <= 0) throw new Error('Ring size must be positive')
  if (sessions.length === 0) throw new Error('Cannot build a switch ring from zero sessions')

  const byDescendingCount = [...sessions].sort((a, b) => (
    b.messageCount - a.messageCount || a.id.localeCompare(b.id)
  ))
  return byDescendingCount.slice(0, Math.min(size, byDescendingCount.length)).map(s => s.id)
}

/**
 * Alternates large and small transcripts so a short switch loop samples large
 * sessions many times instead of once.
 *
 * The fixture holds exactly one session above the large threshold per workspace
 * (the rest are capped well below it), so a largest-first ring visits it a single
 * time and yields a one-sample "P95". Alternating also makes each large switch a
 * genuine load rather than a warm re-selection.
 */
export function buildSwitchRing(sessions: readonly SessionRef[], size: number): string[] {
  if (size <= 0) throw new Error('Ring size must be positive')
  if (sessions.length === 0) throw new Error('Cannot build a switch ring from zero sessions')

  const ordered = [...sessions].sort((a, b) => (
    b.messageCount - a.messageCount || a.id.localeCompare(b.id)
  ))
  const large = ordered.filter(s => s.messageCount >= LARGE_SESSION_MESSAGES)
  const small = ordered.filter(s => s.messageCount < LARGE_SESSION_MESSAGES)
  if (large.length === 0 || small.length === 0) {
    return ordered.slice(0, Math.min(size, ordered.length)).map(s => s.id)
  }

  const ring: string[] = []
  for (let i = 0; ring.length < size; i++) {
    ring.push(large[i % large.length].id)
    if (ring.length < size) ring.push(small[i % small.length].id)
    // Exhausting distinct small sessions is fine — repeats still force a reload
    // because the ring never selects the same session twice in a row.
    if (i > size) break
  }
  return ring.slice(0, size)
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
