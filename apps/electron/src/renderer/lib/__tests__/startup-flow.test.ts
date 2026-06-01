// input: Startup workspace facts after auth/setup checks
// output: Expected renderer app state for first-run, project-hub, and explicit workspace flows
// pos: Guards project-management-first routing before the main app shell is shown

import { describe, expect, it } from 'bun:test'
import { resolvePostSetupAppState } from '../startup-flow'

describe('resolvePostSetupAppState', () => {
  it('opens the project hub empty state when no workspace exists', () => {
    expect(resolvePostSetupAppState({ windowWorkspaceId: '', workspaceCount: 0 })).toBe('project-hub')
  })

  it('opens the project hub when setup is complete and existing projects are available', () => {
    expect(resolvePostSetupAppState({ windowWorkspaceId: '', workspaceCount: 2 })).toBe('project-hub')
  })

  it('enters the app shell when the window already has a workspace', () => {
    expect(resolvePostSetupAppState({ windowWorkspaceId: 'workspace-1', workspaceCount: 1 })).toBe('ready')
  })

  it('does not route authenticated users through a profile handoff page', () => {
    expect(resolvePostSetupAppState({
      windowWorkspaceId: '',
      workspaceCount: 1,
    })).toBe('project-hub')
  })
})
