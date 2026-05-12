// input: Session metadata returned after an in-window workspace switch
// output: Regression coverage for choosing the first openable session after switching workspaces
// pos: Guards workspace switch hydration against empty main-panel states

import { describe, expect, it } from 'bun:test'
import type { Session } from '../../../shared/types'
import { getAutoSessionIdForWorkspaceSwitch } from '../workspace-switch'

function session(overrides: Partial<Session> & Pick<Session, 'id'>): Session {
  return {
    workspaceId: overrides.workspaceId ?? 'workspace-1',
    workspaceName: overrides.workspaceName ?? 'Workspace',
    messages: [],
    lastMessageAt: overrides.lastMessageAt ?? 0,
    isProcessing: false,
    sessionFolderPath: '',
    supportsBranching: true,
    ...overrides,
  } as Session
}

describe('getAutoSessionIdForWorkspaceSwitch', () => {
  it('returns the newest visible session for the selected workspace', () => {
    expect(getAutoSessionIdForWorkspaceSwitch([
      session({ id: 'old', workspaceId: 'workspace-1', lastMessageAt: 10 }),
      session({ id: 'new', workspaceId: 'workspace-1', lastMessageAt: 20 }),
      session({ id: 'other', workspaceId: 'workspace-2', lastMessageAt: 30 }),
    ], 'workspace-1')).toBe('new')
  })

  it('skips hidden and archived sessions', () => {
    expect(getAutoSessionIdForWorkspaceSwitch([
      session({ id: 'hidden', hidden: true, lastMessageAt: 30 }),
      session({ id: 'archived', isArchived: true, lastMessageAt: 20 }),
      session({ id: 'visible', lastMessageAt: 10 }),
    ], 'workspace-1')).toBe('visible')
  })

  it('accepts the remote workspace id mapping when present', () => {
    expect(getAutoSessionIdForWorkspaceSwitch([
      session({ id: 'remote-session', workspaceId: 'remote-1', lastMessageAt: 10 }),
    ], 'local-1', 'remote-1')).toBe('remote-session')
  })
})
