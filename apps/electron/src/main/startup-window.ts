// input: Persisted window/workspace records at desktop startup
// output: Window restoration policy and fallback workspace selection
// pos: Restores the last desktop session while rejecting stale project windows

import { FREE_CONVERSATION_WORKSPACE_ID } from '@craft-agent/shared/protocol'
import type { SavedWindow } from './window-state'

export function resolveStartupWindowWorkspaceId(workspaces: Array<{ id: string }>): string {
  void workspaces
  return ''
}

export function shouldRestoreWorkspaceWindowsOnOrdinaryStartup(input: {
  savedWindowCount: number
}): boolean {
  return input.savedWindowCount > 0
}

export function isRestorableWindowWorkspace(
  workspaceId: string,
  workspaces: Array<{ id: string; archivedAt?: number; remoteServer?: unknown }>,
  hasRemoteCredential: (workspaceId: string) => boolean = () => false,
): boolean {
  if (workspaceId === FREE_CONVERSATION_WORKSPACE_ID) return true
  const workspace = workspaces.find(candidate => candidate.id === workspaceId && !candidate.archivedAt)
  if (!workspace) return false
  return !workspace.remoteServer || hasRemoteCredential(workspace.id)
}

export function resolvePersistedWindowsAfterClose(
  remainingWindows: SavedWindow[],
  closingWindow: SavedWindow,
): SavedWindow[] {
  return remainingWindows.length > 0 ? remainingWindows : [closingWindow]
}

export function shouldSaveOpenWindowsOnQuit(openWindowCount: number): boolean {
  return openWindowCount > 0
}

export function resolveActivateWindowWorkspaceId(workspaces: Array<{ id: string }>): string {
  return resolveStartupWindowWorkspaceId(workspaces)
}
