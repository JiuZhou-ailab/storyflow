// input: Renderer bootstrap readiness flags
// output: Regression coverage for splash exit gating
// pos: Prevents default workspace/theme UI from flashing before first-frame data is loaded

import { describe, expect, it } from 'bun:test'
import { isAppFullyReady } from '../app-readiness'

describe('isAppFullyReady', () => {
  it('does not release the splash when sessions are loaded but workspace data is still pending', () => {
    expect(isAppFullyReady({
      appState: 'ready',
      sessionsLoaded: true,
      workspacesLoaded: false,
      themeLoaded: true,
      llmConnectionsLoaded: true,
      draftsLoaded: true,
      notificationsLoaded: true,
    })).toBe(false)
  })

  it('does not release the splash before the app enters ready state', () => {
    expect(isAppFullyReady({
      appState: 'loading',
      sessionsLoaded: true,
      workspacesLoaded: true,
      themeLoaded: true,
      llmConnectionsLoaded: true,
      draftsLoaded: true,
      notificationsLoaded: true,
    })).toBe(false)
  })

  it('releases the splash once all first-frame data is loaded', () => {
    expect(isAppFullyReady({
      appState: 'ready',
      sessionsLoaded: true,
      workspacesLoaded: true,
      themeLoaded: true,
      llmConnectionsLoaded: true,
      draftsLoaded: true,
      notificationsLoaded: true,
    })).toBe(true)
  })
})
