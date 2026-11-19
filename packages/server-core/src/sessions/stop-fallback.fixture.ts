// input: A SessionManager whose session is processing a turn
// output: A real user stop whose 5-second timeout fallback fires on demand and can be held at its flush
// pos: Test fixture for late results that arrive while (or after) stop cleanup finishes the turn

import { jest } from 'bun:test'
import type { SessionManager } from './SessionManager.ts'

/**
 * Hold the stop fallback's cleanup at its session flush. While held, stopRequested is already
 * reset and isProcessing is still true for the same generation, the window a late result must not use.
 */
export function holdStopCleanupAtFlush(sm: SessionManager) {
  const internal = sm as unknown as {
    persistSession: (...args: unknown[]) => void
    flushSession: (sessionId: string) => Promise<void>
    onProcessingStopped: (...args: unknown[]) => Promise<void>
  }
  let markFlushStarted!: () => void
  let releaseFlush!: () => void
  const flushStarted = new Promise<void>(done => { markFlushStarted = done })
  const flushReleased = new Promise<void>(done => { releaseFlush = done })
  // Cleanup must not write test sessions to disk; only its ordering matters here.
  internal.persistSession = () => {}
  internal.flushSession = async () => {
    markFlushStarted()
    await flushReleased
  }
  const stopProcessing = internal.onProcessingStopped.bind(sm)
  const cleanups: Promise<void>[] = []
  internal.onProcessingStopped = (...args: unknown[]) => {
    const cleanup = stopProcessing(...args)
    cleanups.push(cleanup)
    return cleanup
  }
  return {
    flushStarted,
    releaseFlush,
    /** Every stop cleanup started so far, including the fallback's, has finished. */
    finished: async () => { await Promise.all(cleanups) },
  }
}

/** Press stop for real, then let its 5-second timeout fallback fire instead of waiting for it. */
export async function stopAndFireTimeoutFallback(sm: SessionManager, sessionId: string): Promise<void> {
  jest.useFakeTimers()
  try {
    await sm.cancelProcessing(sessionId)
    jest.advanceTimersByTime(5000)
  } finally {
    jest.useRealTimers()
  }
}
