// input: Startup policy helpers and persisted window-state payloads
// output: Regression coverage for Electron startup window gating and state validation
// pos: Verifies startup failures or corrupt state cannot create broken UI windows

import { describe, expect, it } from 'bun:test'
import { shouldCreateWindowsAfterStartup } from '../startup-state'
import { parseWindowState } from '../window-state'

describe('shouldCreateWindowsAfterStartup', () => {
  it('blocks UI window creation after non-client startup failure', () => {
    expect(shouldCreateWindowsAfterStartup({
      initSucceeded: false,
      isHeadless: false,
    })).toBe(false)
  })

  it('allows UI window creation after successful desktop startup', () => {
    expect(shouldCreateWindowsAfterStartup({
      initSucceeded: true,
      isHeadless: false,
    })).toBe(true)
  })

  it('blocks UI window creation in headless mode', () => {
    expect(shouldCreateWindowsAfterStartup({
      initSucceeded: true,
      isHeadless: true,
    })).toBe(false)
  })
})

describe('parseWindowState', () => {
  it('accepts a complete persisted window', () => {
    expect(parseWindowState({
      windows: [{
        type: 'main',
        workspaceId: 'workspace-1',
        bounds: { x: 0, y: 0, width: 1200, height: 800 },
      }],
    })).not.toBeNull()
  })

  it('rejects malformed bounds', () => {
    expect(parseWindowState({
      windows: [{
        type: 'main',
        workspaceId: 'workspace-1',
        bounds: { x: 0, y: 0, width: 0, height: 800 },
      }],
    })).toBeNull()
  })
})
