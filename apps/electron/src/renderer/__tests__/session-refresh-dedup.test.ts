// input: App renderer source for full session refresh recovery
// output: Regression guard that prevents duplicate full-message IPC reloads
// pos: Keeps reconnect/watchdog recovery from stacking getSessionMessages calls

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf-8')

describe('session refresh recovery', () => {
  it('deduplicates concurrent full session refreshes by session id', () => {
    const refreshStart = appSource.indexOf('const refreshSessionFromServer = useCallback')
    const refreshEnd = appSource.indexOf('const loadSessionsFromServer = useCallback', refreshStart)
    const refreshSource = appSource.slice(refreshStart, refreshEnd)

    expect(appSource).toContain('const sessionRefreshInFlightRef = useRef<Map<string, Promise<SessionRefreshResult>>>(new Map())')
    expect(refreshSource).toContain('const inFlight = sessionRefreshInFlightRef.current.get(sessionId)')
    expect(refreshSource).toContain('if (inFlight) return inFlight')
    expect(refreshSource).toContain('sessionRefreshInFlightRef.current.set(sessionId, refreshPromise)')
    expect(refreshSource).toContain('sessionRefreshInFlightRef.current.delete(sessionId)')
  })

  it('deduplicates concurrent session metadata refreshes by refresh key', () => {
    const refreshStart = appSource.indexOf('const refreshSessionListMetadataFromServer = useCallback')
    const refreshEnd = appSource.indexOf('const { trackSessionActivity } = useStaleSessionRecovery', refreshStart)
    const refreshSource = appSource.slice(refreshStart, refreshEnd)

    expect(appSource).toContain('const sessionListMetadataRefreshInFlightRef = useRef<Map<string, Promise<SessionListMetadataRefreshResult>>>(new Map())')
    expect(refreshSource).toContain('const refreshKey = `${windowWorkspaceId ??')
    expect(refreshSource).toContain('const inFlight = sessionListMetadataRefreshInFlightRef.current.get(refreshKey)')
    expect(refreshSource).toContain('if (inFlight) return inFlight')
    expect(refreshSource).toContain('sessionListMetadataRefreshInFlightRef.current.set(refreshKey, refreshPromise)')
    expect(refreshSource).toContain('sessionListMetadataRefreshInFlightRef.current.delete(refreshKey)')
  })
})
