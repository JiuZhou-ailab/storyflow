// input: The local Host session manager, workspace lookup, and the loopback RPC endpoint
// output: Workspace, transfer, relaunch, language, and preload sync IPC for a running Host
// pos: Registered only after the embedded server exists; absent in thin-client mode

import { app, ipcMain } from 'electron'
import { i18n } from '@craft-agent/shared/i18n'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { getWorkspaceByNameOrId, getWorkspaces } from '@craft-agent/shared/config'
import type { SessionManager } from '@craft-agent/server-core/sessions'
import { getStartupRelaunchArgs } from '../startup-state'

interface HostIpcDeps {
  sessionManager: SessionManager
  getWorkspaceId(webContentsId: number): string | null | undefined
  endpoint(): { url: string; ca?: string }
  token: string
}

export function registerHostIpc(deps: HostIpcDeps): void {
  const { sessionManager } = deps

  // IPC handlers — preload uses sendSync to get WS connection details

  // Remove workspace from config (cleanup stale entries)
  ipcMain.handle('workspace:setArchived', async (_event, workspaceId: string, archived: boolean) => {
    const { setWorkspaceArchived } = await import('@craft-agent/shared/config')
    return setWorkspaceArchived(workspaceId, archived)
  })

  ipcMain.handle('workspace:remove', async (_event, workspaceId: string) => {
    return sessionManager.removeWorkspace(workspaceId)
  })

  // Cross-server RPC — invoke a channel on an arbitrary remote server
  ipcMain.handle('server:invokeOnServer', async (_event, url: string, token: string, channel: string, ...args: unknown[]) => {
    const { connectToRemote } = await import('./workspace')
    const { client, error } = await connectToRemote(url, token)
    if (!client) throw new Error(error ?? 'Connection failed')
    try {
      return await client.invoke(channel, ...args)
    } finally {
      client.destroy()
    }
  })

  // Transfer one immutable summary snapshot to a fresh session on another
  // server. Provider transcripts and workspace files never cross domains.
  ipcMain.handle('session:transferToRemoteWorkspace', async (_event, sessionId: string, targetWorkspaceId: string) => {
    const { resolveRuntimeWorkspaceById } = await import('@craft-agent/shared/workspaces')
    const { connectToRemote } = await import('./workspace')

    const targetWorkspace = resolveRuntimeWorkspaceById(targetWorkspaceId)
    if (!targetWorkspace) throw new Error(`Target workspace ${targetWorkspaceId} not found`)
    if (!sessionManager) throw new Error('Session manager not initialized')

    const sourceWorkspaceLocalId = deps.getWorkspaceId(_event.sender.id)
    if (!sourceWorkspaceLocalId) throw new Error('Unable to resolve source workspace for transfer')

    const sourceWorkspace = resolveRuntimeWorkspaceById(sourceWorkspaceLocalId)
    if (!sourceWorkspace) throw new Error(`Source workspace ${sourceWorkspaceLocalId} not found`)

    let transferPayload: import('@craft-agent/shared/protocol').RemoteSessionTransferPayload

    if (sourceWorkspace.remoteServer) {
      const { url: sourceUrl, remoteWorkspaceId: sourceRemoteWorkspaceId } = sourceWorkspace.remoteServer
      const sourceToken = await getCredentialManager().getRemoteServerToken(sourceWorkspace.id)
      if (!sourceToken) throw new Error('Source remote server credential is unavailable')
      console.log(`[Transfer] Exporting remote-owned session ${sessionId} from workspace ${sourceRemoteWorkspaceId}...`)
      const { client: sourceClient, error: sourceError } = await connectToRemote(sourceUrl, sourceToken, sourceRemoteWorkspaceId)
      if (!sourceClient) throw new Error(sourceError ?? 'Connection failed to source remote server')

      try {
        transferPayload = await sourceClient.invoke('sessions:exportRemoteTransfer', sessionId)
        if (!transferPayload?.summary) throw new Error(`Failed to summarize session ${sessionId}`)
      } finally {
        sourceClient.destroy()
      }
    } else {
      const payload = await sessionManager.exportRemoteSessionTransfer(sessionId, sourceWorkspace.id)
      if (!payload) throw new Error(`Failed to summarize session ${sessionId}`)
      transferPayload = payload
    }

    if (!targetWorkspace.remoteServer) {
      return sessionManager.importRemoteSessionTransfer(
        targetWorkspace.id,
        transferPayload,
      )
    }

    const { url, remoteWorkspaceId } = targetWorkspace.remoteServer
    const token = await getCredentialManager().getRemoteServerToken(targetWorkspace.id)
    if (!token) throw new Error('Target remote server credential is unavailable')
    console.log(`[Transfer] Connecting to target remote server: ${url}`)
    const { client, error } = await connectToRemote(url, token, remoteWorkspaceId)
    if (!client) throw new Error(error ?? 'Connection failed to target remote server')
    console.log('[Transfer] Connected to target remote server')

    try {
      const result = await client.invoke(
        'sessions:importRemoteTransfer',
        remoteWorkspaceId,
        transferPayload,
      )
      return result
    } finally {
      client.destroy()
    }
  })

  // App relaunch (for server config changes — NOT an update install)
  ipcMain.handle('app:relaunch', () => {
    app.relaunch({ args: getStartupRelaunchArgs(process.argv) })
    app.quit()
  })

  // Language change: sync from renderer to main process and rebuild native menu
  ipcMain.handle('i18n:changeLanguage', async (_event, lang: string) => {
    i18n.changeLanguage(lang)
    const { rebuildMenu } = await import('../menu')
    await rebuildMenu()
  })

  ipcMain.on('__get-ws-endpoint', (e) => {
    e.returnValue = deps.endpoint()
  })
  ipcMain.on('__get-ws-token', (e) => {
    e.returnValue = deps.token
  })
  ipcMain.on('__get-workspace-remote-config', (e) => {
    const wsId = deps.getWorkspaceId(e.sender.id)
    if (!wsId) { e.returnValue = null; return }
    const ws = getWorkspaceByNameOrId(wsId)
    if (!ws?.remoteServer) { e.returnValue = null; return }
    e.returnValue = {
      url: ws.remoteServer.url,
      token: getCredentialManager().peekRemoteServerToken(ws.id) ?? '',
      remoteWorkspaceId: ws.remoteServer.remoteWorkspaceId,
    }
  })
  ipcMain.on('__get-remote-server-token', (e, credentialRef: unknown) => {
    if (typeof credentialRef !== 'string') { e.returnValue = null; return }
    const workspace = getWorkspaces().find(
      candidate => candidate.remoteServer?.credentialRef === credentialRef,
    )
    e.returnValue = workspace
      ? getCredentialManager().peekRemoteServerToken(workspace.id)
      : null
  })
}
