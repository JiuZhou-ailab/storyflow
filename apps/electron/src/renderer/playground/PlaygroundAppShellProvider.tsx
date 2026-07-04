/**
 * PlaygroundAppShellProvider
 *
 * Minimal stand-in for the real AppShellProvider so components that rely on
 * `useActiveWorkspace()` / `useAppShellContext()` (e.g. MessagingSettingsPage)
 * can render inside the playground without the full app shell wiring.
 *
 * All callbacks are no-op logging stubs — interactions just go to the console.
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import { AppShellProvider, type AppShellContextType } from '../context/AppShellContext'
import { windowWorkspaceIdAtom, windowWorkspacesAtom } from '../atoms/sessions'
import type { Workspace } from '../../shared/types'

const PLAYGROUND_WORKSPACE: Workspace = {
  id: 'playground-workspace',
  name: 'Playground',
  slug: 'playground',
  rootPath: '/mock/workspaces/playground-workspace',
  createdAt: Date.now(),
}

function logCall(method: string) {
  return (...args: unknown[]) => {
    console.log(`[Playground AppShell] ${method} called`, args)
  }
}

// Build a minimal value that satisfies the type. Most callbacks are no-ops;
// workspace atoms below let `useActiveWorkspace()` resolve in playground.
const playgroundValue: AppShellContextType = {
  workspaces: [PLAYGROUND_WORKSPACE],
  activeWorkspaceId: PLAYGROUND_WORKSPACE.id,
  activeWorkspaceSlug: PLAYGROUND_WORKSPACE.slug,
  llmConnections: [],
  refreshLlmConnections: async () => {},
  getDraft: () => '',
  getDraftAttachmentRefs: () => [],
  hydrateDraftAttachments: async () => [],
  onCreateSession: (async () => {
    throw new Error('[Playground] onCreateSession is not available')
  }) as AppShellContextType['onCreateSession'],
  onSendMessage: logCall('onSendMessage'),
  onRenameSession: logCall('onRenameSession'),
  onFlagSession: logCall('onFlagSession'),
  onUnflagSession: logCall('onUnflagSession'),
  onArchiveSession: logCall('onArchiveSession'),
  onUnarchiveSession: logCall('onUnarchiveSession'),
  onMarkSessionRead: logCall('onMarkSessionRead'),
  onMarkSessionUnread: logCall('onMarkSessionUnread'),
  onSetActiveViewingSession: logCall('onSetActiveViewingSession'),
  onSessionStatusChange: logCall('onSessionStatusChange'),
  onDeleteSession: async () => {
    console.log('[Playground AppShell] onDeleteSession called')
    return false
  },
  onOpenFile: logCall('onOpenFile'),
  onOpenUrl: logCall('onOpenUrl'),
  onSelectWorkspace: logCall('onSelectWorkspace'),
  onOpenSettings: logCall('onOpenSettings'),
  onOpenKeyboardShortcuts: logCall('onOpenKeyboardShortcuts'),
  onOpenStoredUserPreferences: logCall('onOpenStoredUserPreferences'),
  onReset: logCall('onReset'),
  onSessionOptionsChange: logCall('onSessionOptionsChange'),
  onInputChange: logCall('onInputChange'),
  onAttachmentsChange: logCall('onAttachmentsChange'),
}

export function PlaygroundAppShellProvider({ children }: { children: React.ReactNode }) {
  const setWindowWorkspaceId = useSetAtom(windowWorkspaceIdAtom)
  const setWindowWorkspaces = useSetAtom(windowWorkspacesAtom)

  React.useEffect(() => {
    setWindowWorkspaceId(PLAYGROUND_WORKSPACE.id)
    setWindowWorkspaces([PLAYGROUND_WORKSPACE])
    return () => {
      setWindowWorkspaceId(null)
      setWindowWorkspaces([])
    }
  }, [setWindowWorkspaceId, setWindowWorkspaces])

  return <AppShellProvider value={playgroundValue}>{children}</AppShellProvider>
}
