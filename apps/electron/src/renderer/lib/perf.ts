// input: Renderer runtime events and debug-mode startup state
// output: Debug-only renderer performance metrics for session switches and text deltas
// pos: Renderer performance instrumentation boundary with no UI state ownership

/**
 * Renderer-side Performance Instrumentation
 *
 * Tracks session switch timing from click to render complete.
 * Logs via electron-log to the main log file.
 *
 * Usage:
 *   // At the earliest known navigation entry:
 *   rendererPerf.startSessionSwitch(sessionId)
 *
 *   // In ChatTabPanel when session loads:
 *   rendererPerf.markSessionSwitch(sessionId, 'session.loaded')
 *
 *   // When render is complete:
 *   rendererPerf.endSessionSwitch(sessionId)
 */

import log from 'electron-log/renderer'

const perfLog = log.scope('perf')

interface SessionSwitchMetric {
  sessionId: string
  startTime: number
  marks: Array<{ name: string; elapsed: number }>
  endTime?: number
  duration?: number
}

interface TextDeltaPerfEvent {
  sessionId: string
  delta: string
}

interface NovelDocumentPerfEvent {
  filePath: string
  phase: string
  durationMs: number
  contentLength?: number
}

interface TextDeltaPerfSummary {
  sessionId: string
  deltaLength: number
}

interface NovelDocumentPerfSummary {
  fileName: string
  phase: string
  durationMs: number
  contentLength?: number
}

interface TextDeltaWindow {
  startedAt: number
  count: number
  chars: number
  turnId?: string
}

// Pending session switches (keyed by sessionId)
const pendingSwitches = new Map<string, SessionSwitchMetric>()
const textDeltaWindows = new Map<string, TextDeltaWindow>()

// Recent completed metrics for analysis
const recentMetrics: SessionSwitchMetric[] = []
const MAX_RECENT_METRICS = 50
const TEXT_DELTA_LOG_INTERVAL_MS = 1000

// Debug mode detection (matches main process pattern)
let debugMode = false

/**
 * Initialize perf tracking. Call this once on app startup.
 * In Electron renderer, we check if we're in dev mode.
 */
export function initRendererPerf(isDebug: boolean): void {
  debugMode = isDebug
  if (debugMode) {
    perfLog.info('Renderer performance tracking enabled')
  }
}

/**
 * Check if perf tracking is enabled
 */
export function isRendererPerfEnabled(): boolean {
  return debugMode
}

export function summarizeTextDeltaPerfEvent(event: TextDeltaPerfEvent): TextDeltaPerfSummary {
  return {
    sessionId: event.sessionId,
    deltaLength: event.delta.length,
  }
}

export function summarizeNovelDocumentPerfEvent(event: NovelDocumentPerfEvent): NovelDocumentPerfSummary {
  const normalizedPath = event.filePath.replace(/\\/g, '/')
  return {
    fileName: normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1) || normalizedPath,
    phase: event.phase,
    durationMs: Math.round(event.durationMs),
    contentLength: event.contentLength,
  }
}

export function recordNovelDocumentEvent(event: NovelDocumentPerfEvent): void {
  if (!debugMode) return

  const summary = summarizeNovelDocumentPerfEvent(event)
  perfLog.info(
    `writing.document.${summary.phase}: ${summary.durationMs}ms` +
      (summary.contentLength == null ? '' : `, chars=${summary.contentLength}`) +
      (summary.fileName ? `, file=${summary.fileName}` : '')
  )
}

export function recordTextDeltaEvent(sessionId: string, delta: string, turnId?: string): void {
  if (!debugMode) return

  const now = performance.now()
  const summary = summarizeTextDeltaPerfEvent({ sessionId, delta })
  const existing = textDeltaWindows.get(summary.sessionId)

  if (!existing) {
    textDeltaWindows.set(summary.sessionId, {
      startedAt: now,
      count: 1,
      chars: summary.deltaLength,
      turnId,
    })
    return
  }

  existing.count += 1
  existing.chars += summary.deltaLength
  if (turnId) existing.turnId = turnId

  const elapsed = now - existing.startedAt
  if (elapsed < TEXT_DELTA_LOG_INTERVAL_MS) {
    return
  }

  perfLog.info(
    `${summary.sessionId.slice(0, 8)}... text_delta.window: ` +
      `${existing.count} events, ${existing.chars} chars, ${elapsed.toFixed(1)}ms` +
      (existing.turnId ? `, turn=${existing.turnId}` : '')
  )
  textDeltaWindows.set(summary.sessionId, {
    startedAt: now,
    count: 0,
    chars: 0,
    turnId: existing.turnId,
  })
}

/**
 * Start tracking a session switch.
 * The first caller owns the start time; later lifecycle callers for the same
 * session only ensure the metric exists. Starting another session abandons
 * the previous incomplete switch.
 */
export function startSessionSwitch(sessionId: string): void {
  if (!debugMode) return

  // Preserve the earliest interaction start when ChatPage mounts after a list click.
  if (pendingSwitches.has(sessionId)) return

  // Clear any other pending switches - user navigated away before they completed
  pendingSwitches.clear()

  const metric: SessionSwitchMetric = {
    sessionId,
    startTime: performance.now(),
    marks: [],
  }
  pendingSwitches.set(sessionId, metric)

  perfLog.info(`${sessionId.slice(0, 8)}... session-switch.start: 0.0ms`)
}

/**
 * Add a checkpoint mark during session switch.
 * Use for intermediate steps like 'session.loaded', 'agent.status', etc.
 */
export function markSessionSwitch(sessionId: string, markName: string): void {
  if (!debugMode) return

  const metric = pendingSwitches.get(sessionId)
  if (!metric) return
  // React StrictMode may replay layout effects; each named checkpoint is single-shot.
  if (metric.marks.some((mark) => mark.name === markName)) return

  const elapsed = performance.now() - metric.startTime
  metric.marks.push({ name: markName, elapsed })

  perfLog.info(`${sessionId.slice(0, 8)}... ${markName}: ${elapsed.toFixed(1)}ms`)
}

/**
 * End session switch tracking and log final duration.
 * Call this when the chat display has fully rendered.
 */
export function endSessionSwitch(sessionId: string): number | null {
  if (!debugMode) return null

  const metric = pendingSwitches.get(sessionId)
  if (!metric) return null

  metric.endTime = performance.now()
  metric.duration = metric.endTime - metric.startTime

  // Store in recent metrics
  recentMetrics.push(metric)
  if (recentMetrics.length > MAX_RECENT_METRICS) {
    recentMetrics.shift()
  }

  // Clean up pending
  pendingSwitches.delete(sessionId)

  // Log completion with breakdown
  const marksStr = metric.marks.map((m) => `${m.name}:${m.elapsed.toFixed(0)}ms`).join(' → ')
  perfLog.info(
    `Session switch complete: ${metric.duration.toFixed(1)}ms` +
      (marksStr ? ` (${marksStr})` : '')
  )

  return metric.duration
}

export function cancelSessionSwitch(sessionId: string): void {
  if (!debugMode) return
  pendingSwitches.delete(sessionId)
}

/**
 * Get recent session switch metrics for analysis
 */
export function getRecentMetrics(): SessionSwitchMetric[] {
  return [...recentMetrics]
}

/**
 * Get statistics for session switch times
 */
export function getSessionSwitchStats(): {
  count: number
  avgMs: number
  p50Ms: number
  p95Ms: number
  minMs: number
  maxMs: number
} | null {
  if (recentMetrics.length === 0) return null

  const durations = recentMetrics
    .filter((m) => m.duration !== undefined)
    .map((m) => m.duration!)

  if (durations.length === 0) return null

  const sorted = [...durations].sort((a, b) => a - b)
  const sum = durations.reduce((a, b) => a + b, 0)

  return {
    count: durations.length,
    avgMs: sum / durations.length,
    p50Ms: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
    p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
  }
}

/**
 * Clear all metrics
 */
export function clearMetrics(): void {
  pendingSwitches.clear()
  textDeltaWindows.clear()
  recentMetrics.length = 0
}

// Export as namespace for convenient usage
export const rendererPerf = {
  init: initRendererPerf,
  isEnabled: isRendererPerfEnabled,
  startSessionSwitch,
  markSessionSwitch,
  endSessionSwitch,
  cancelSessionSwitch,
  recordTextDeltaEvent,
  recordNovelDocumentEvent,
  getRecentMetrics,
  getStats: getSessionSwitchStats,
  clear: clearMetrics,
}

export default rendererPerf
