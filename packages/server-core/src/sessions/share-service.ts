// input: ManagedSession entries, the broadcaster, stored-session reads/metadata writes, and the viewer endpoint
// output: Share-to-viewer lifecycle (create/update/revoke) with async-operation UI signaling
// pos: Stateless session-sharing functions under the SessionManager facade; the Facade owns registry lookup and not-found guards

import { loadSession as loadStoredSession, updateSessionMetadata } from '@craft-agent/shared/sessions'
import type { ShareResult } from '@craft-agent/shared/protocol'
import type { ManagedSession } from './managed-session'
import type { SessionBroadcaster } from './session-broadcaster'
import { getSessionLog } from './session-runtime'

/**
 * Share session to the web viewer.
 * Uploads session data and returns shareable URL.
 */
export async function shareToViewer(managed: ManagedSession, broadcaster: SessionBroadcaster): Promise<ShareResult> {
  const sessionId = managed.id

  // Signal async operation start for shimmer effect
  managed.isAsyncOperationOngoing = true
  broadcaster.sendEvent({ type: 'async_operation', sessionId, isOngoing: true }, managed.workspace.id)

  try {
    // Load session directly from disk (already in correct format)
    const storedSession = loadStoredSession(managed.workspace.rootPath, sessionId)
    if (!storedSession) {
      return { success: false, error: 'Session file not found' }
    }

    const { VIEWER_URL } = await import('@craft-agent/shared/branding')
    const response = await fetch(`${VIEWER_URL}/s/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(storedSession)
    })

    if (!response.ok) {
      getSessionLog().error(`Share failed with status ${response.status}`)
      if (response.status === 413) {
        return { success: false, error: 'Session file is too large to share' }
      }
      return { success: false, error: 'Failed to upload session' }
    }

    const data = await response.json() as { id: string; url: string }

    // Store shared info in session
    managed.sharedUrl = data.url
    managed.sharedId = data.id
    const workspaceRootPath = managed.workspace.rootPath
    await updateSessionMetadata(workspaceRootPath, sessionId, {
      sharedUrl: data.url,
      sharedId: data.id,
    })

    getSessionLog().info(`Session ${sessionId} shared at ${data.url}`)
    // Notify all windows for this workspace
    broadcaster.sendEvent({ type: 'session_shared', sessionId, sharedUrl: data.url }, managed.workspace.id)
    return { success: true, url: data.url }
  } catch (error) {
    getSessionLog().error('Share error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  } finally {
    // Signal async operation end
    managed.isAsyncOperationOngoing = false
    broadcaster.sendEvent({ type: 'async_operation', sessionId, isOngoing: false }, managed.workspace.id)
  }
}

/**
 * Update an existing shared session.
 * Re-uploads session data to the same URL.
 */
export async function updateShare(managed: ManagedSession, broadcaster: SessionBroadcaster): Promise<ShareResult> {
  const sessionId = managed.id
  if (!managed.sharedId) {
    return { success: false, error: 'Session not shared' }
  }

  // Signal async operation start for shimmer effect
  managed.isAsyncOperationOngoing = true
  broadcaster.sendEvent({ type: 'async_operation', sessionId, isOngoing: true }, managed.workspace.id)

  try {
    // Load session directly from disk (already in correct format)
    const storedSession = loadStoredSession(managed.workspace.rootPath, sessionId)
    if (!storedSession) {
      return { success: false, error: 'Session file not found' }
    }

    const { VIEWER_URL } = await import('@craft-agent/shared/branding')
    const response = await fetch(`${VIEWER_URL}/s/api/${managed.sharedId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(storedSession)
    })

    if (!response.ok) {
      getSessionLog().error(`Update share failed with status ${response.status}`)
      if (response.status === 413) {
        return { success: false, error: 'Session file is too large to share' }
      }
      return { success: false, error: 'Failed to update shared session' }
    }

    getSessionLog().info(`Session ${sessionId} share updated at ${managed.sharedUrl}`)
    return { success: true, url: managed.sharedUrl }
  } catch (error) {
    getSessionLog().error('Update share error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  } finally {
    // Signal async operation end
    managed.isAsyncOperationOngoing = false
    broadcaster.sendEvent({ type: 'async_operation', sessionId, isOngoing: false }, managed.workspace.id)
  }
}

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
    const { VIEWER_URL } = await import('@craft-agent/shared/branding')
    const response = await fetch(
      `${VIEWER_URL}/s/api/${managed.sharedId}`,
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
