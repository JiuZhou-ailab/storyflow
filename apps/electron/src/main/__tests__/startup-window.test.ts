// input: Stored workspace list at desktop startup
// output: Workspace id passed to the first BrowserWindow
// pos: Keeps ordinary startup on the project hub instead of auto-opening a project

import { describe, expect, it } from 'bun:test'
import {
  resolveActivateWindowWorkspaceId,
  resolveStartupWindowWorkspaceId,
  shouldRestoreWorkspaceWindowsOnOrdinaryStartup,
} from '../startup-window'

describe('resolveStartupWindowWorkspaceId', () => {
  it('returns an empty workspace id when no projects exist yet', () => {
    expect(resolveStartupWindowWorkspaceId([])).toBe('')
  })

  it('returns an empty workspace id for existing users so startup opens the project hub', () => {
    expect(resolveStartupWindowWorkspaceId([{ id: 'workspace-1' }])).toBe('')
  })

  it('does not restore saved workspace windows during ordinary startup', () => {
    expect(shouldRestoreWorkspaceWindowsOnOrdinaryStartup({ savedWindowCount: 2 })).toBe(false)
  })

  it('returns an empty workspace id when macOS dock activation recreates the app window', () => {
    expect(resolveActivateWindowWorkspaceId([{ id: 'workspace-1' }])).toBe('')
  })
})
