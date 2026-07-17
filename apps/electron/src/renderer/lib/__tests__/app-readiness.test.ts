// input: Renderer route state and selected workspace identity
// output: Regression coverage for project-shell splash gating
// pos: Prevents background agent/session hydration from blocking the editor

import { describe, expect, it } from 'bun:test'
import { isProjectShellReady } from '../app-readiness'

describe('isProjectShellReady', () => {
  it('does not release the splash until a project is selected', () => {
    expect(isProjectShellReady({ appState: 'ready', workspaceId: null })).toBe(false)
  })

  it('does not release the splash before the app enters ready state', () => {
    expect(isProjectShellReady({ appState: 'loading', workspaceId: 'workspace-1' })).toBe(false)
  })

  it('releases the splash without waiting for session or agent metadata', () => {
    expect(isProjectShellReady({ appState: 'ready', workspaceId: 'workspace-1' })).toBe(true)
  })
})
