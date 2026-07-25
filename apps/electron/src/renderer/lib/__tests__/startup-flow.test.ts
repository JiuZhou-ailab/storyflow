// input: Startup workspace facts after auth/setup checks
// output: Expected renderer state and non-archived startup-project selection
// pos: Guards direct project entry before the main app shell is shown

import { describe, expect, it } from 'bun:test'
import { resolvePostSetupAppState, selectStartupWorkspaceId } from '../startup-flow'

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

describe('selectStartupWorkspaceId', () => {
  it('selects the most recent active project and ignores archived projects', () => {
    expect(selectStartupWorkspaceId([
      { id: 'older', lastAccessedAt: 10 },
      { id: 'archived', lastAccessedAt: 30, archivedAt: 40 },
      { id: 'recent', lastAccessedAt: 20 },
    ])).toBe('recent')
  })

  it('returns null when every project is archived', () => {
    expect(selectStartupWorkspaceId([
      { id: 'archived', archivedAt: 10 },
    ])).toBeNull()
  })
})
