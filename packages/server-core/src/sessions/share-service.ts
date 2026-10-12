// input: ManagedSession entries, the broadcaster, session metadata writes, and the legacy share cleanup endpoint
// output: Legacy share revocation with async-operation UI signaling
// pos: Stateless session-sharing functions under the SessionManager facade; the Facade owns registry lookup and not-found guards

import { updateSessionMetadata } from '@craft-agent/shared/sessions'
import type { ShareResult } from '@craft-agent/shared/protocol'
import type { ManagedSession } from './managed-session'
import type { SessionBroadcaster } from './session-broadcaster'
import { getSessionLog } from './session-runtime'

/**
 * Revoke a shared session.
 * Deletes from viewer and clears local shared state.
 */
export async function revokeShare(managed: ManagedSession, broadcaster: SessionBroadcaster): Promise<ShareResult> {
  const sessionId = managed.id
  if (!managed.sharedId) {
    return { success: false, error: 'Session not shared' }
  }

  // Signal async operation start for shimmer effect
  managed.isAsyncOperationOngoing = true
  broadcaster.sendEvent({ type: 'async_operation', sessionId, isOngoing: true }, managed.workspace.id)

  try {
    const { LEGACY_SHARE_CLEANUP_URL } = await import('@craft-agent/shared/branding')
    const response = await fetch(
      `${LEGACY_SHARE_CLEANUP_URL}/s/api/${managed.sharedId}`,
      { method: 'DELETE' }
    )

    if (!response.ok) {
      getSessionLog().error(`Revoke failed with status ${response.status}`)
      return { success: false, error: 'Failed to revoke share' }
    }

    // Clear shared info
    delete managed.sharedUrl
    delete managed.sharedId
    const workspaceRootPath = managed.workspace.rootPath
    await updateSessionMetadata(workspaceRootPath, sessionId, {
      sharedUrl: undefined,
      sharedId: undefined,
    })

    getSessionLog().info(`Session ${sessionId} share revoked`)
    // Notify all windows for this workspace
    broadcaster.sendEvent({ type: 'session_unshared', sessionId }, managed.workspace.id)
    return { success: true }
  } catch (error) {
    getSessionLog().error('Revoke error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  } finally {
    // Signal async operation end
    managed.isAsyncOperationOngoing = false
    broadcaster.sendEvent({ type: 'async_operation', sessionId, isOngoing: false }, managed.workspace.id)
  }
}
