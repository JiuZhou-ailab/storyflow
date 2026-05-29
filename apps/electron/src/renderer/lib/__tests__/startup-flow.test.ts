// input: Startup workspace facts after auth/setup checks
// output: Expected renderer app state for first-run and existing-workspace flows
// pos: Guards new-user routing before the main app shell is shown

import { describe, expect, it } from 'bun:test'
import { resolvePostSetupAppState } from '../startup-flow'

describe('resolvePostSetupAppState', () => {
  it('opens the required workspace creation flow when no workspace exists', () => {
    expect(resolvePostSetupAppState({ windowWorkspaceId: '', workspaceCount: 0 })).toBe('workspace-creation')
  })

  it('opens the workspace picker when setup is complete but this window has no selected workspace', () => {
    expect(resolvePostSetupAppState({ windowWorkspaceId: '', workspaceCount: 2 })).toBe('workspace-picker')
  })

  it('enters the app shell when the window already has a workspace', () => {
    expect(resolvePostSetupAppState({ windowWorkspaceId: 'workspace-1', workspaceCount: 1 })).toBe('ready')
  })
})
