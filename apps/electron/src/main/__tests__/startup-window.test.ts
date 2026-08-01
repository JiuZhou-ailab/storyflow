// input: Stored window/workspace state at desktop startup
// output: Expected restoration and fallback workspace decisions
// pos: Guards reopening the last session without reviving stale project windows

import { describe, expect, it } from 'bun:test'
import {
  isRestorableWindowWorkspace,
  resolvePersistedWindowsAfterClose,
  resolveActivateWindowWorkspaceId,
  resolveStartupWindowWorkspaceId,
  shouldSaveOpenWindowsOnQuit,
  shouldRestoreWorkspaceWindowsOnOrdinaryStartup,
} from '../startup-window'
import type { SavedWindow } from '../window-state'

describe('resolveStartupWindowWorkspaceId', () => {
  it('returns an empty workspace id when no projects exist yet', () => {
    expect(resolveStartupWindowWorkspaceId([])).toBe('')
  })

  it('returns an empty workspace id for existing users so startup opens the project hub', () => {
    expect(resolveStartupWindowWorkspaceId([{ id: 'workspace-1' }])).toBe('')
  })

  it('restores saved workspace windows during ordinary startup', () => {
    expect(shouldRestoreWorkspaceWindowsOnOrdinaryStartup({ savedWindowCount: 2 })).toBe(true)
    expect(shouldRestoreWorkspaceWindowsOnOrdinaryStartup({ savedWindowCount: 0 })).toBe(false)
  })

  it('restores active project and hidden free-conversation windows only', () => {
    const workspaces = [
      { id: 'active-project' },
      { id: 'archived-project', archivedAt: 1 },
    ]

    expect(isRestorableWindowWorkspace('__storyflow_free__', workspaces)).toBe(true)
    expect(isRestorableWindowWorkspace('active-project', workspaces)).toBe(true)
    expect(isRestorableWindowWorkspace('archived-project', workspaces)).toBe(false)
    expect(isRestorableWindowWorkspace('missing-project', workspaces)).toBe(false)
  })

  it('does not restore a remote project whose credential is unavailable', () => {
    const workspaces = [{ id: 'remote-project', remoteServer: { url: 'https://example.test' } }]

    expect(isRestorableWindowWorkspace('remote-project', workspaces, () => false)).toBe(false)
    expect(isRestorableWindowWorkspace('remote-project', workspaces, () => true)).toBe(true)
  })

  it('keeps the closing window as the restart target when it was the last window', () => {
    const closingWindow: SavedWindow = {
      type: 'main',
      workspaceId: 'workspace-1',
      bounds: { x: 0, y: 0, width: 1200, height: 800 },
      url: 'file:///renderer/index.html?workspaceId=workspace-1&sessionId=session-1',
    }

    expect(resolvePersistedWindowsAfterClose([], closingWindow)).toEqual([closingWindow])
    expect(shouldSaveOpenWindowsOnQuit(0)).toBe(false)
    expect(shouldSaveOpenWindowsOnQuit(1)).toBe(true)
  })

  it('returns an empty workspace id when macOS dock activation recreates the app window', () => {
    expect(resolveActivateWindowWorkspaceId([{ id: 'workspace-1' }])).toBe('')
  })
})
