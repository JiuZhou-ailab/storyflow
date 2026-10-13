// input: Electron ipcMain plus the window-to-workspace map and main logger
// output: Preload sync bridges for window identity, transport diagnostics, crash reports, and message boxes
// pos: Shell IPC registered before any window loads; does not own auth or the local Host

import { BrowserWindow, dialog, ipcMain } from 'electron'

interface ShellIpcDeps {
  windowManager: { getWorkspaceForWindow(webContentsId: number): string | null } | null
  log: {
    info(message: string, context?: unknown): void
    warn(message: string, context?: unknown): void
    error(message: string, context?: unknown): void
  }
}

export function registerShellIpc(deps: ShellIpcDeps): void {
  const { windowManager, log } = deps

  // Bootstrap IPC handlers — preload uses sendSync for window-local details
  ipcMain.on('__get-web-contents-id', (e) => {
    e.returnValue = e.sender.id
  })
  ipcMain.on('__get-workspace-id', (e) => {
    e.returnValue = windowManager?.getWorkspaceForWindow(e.sender.id) ?? ''
  })

  // Transport diagnostics bridge — preload reports remote WS connection state changes
  // so failures are visible in terminal/main.log (not only renderer console).
  ipcMain.on('__transport:status', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const p = payload as {
      level?: 'info' | 'warn' | 'error'
      message?: string
      status?: string
      attempt?: number
      nextRetryInMs?: number
      error?: unknown
      close?: unknown
      url?: string
    }

    const level = p.level ?? 'info'
    const message = p.message ?? '[transport] status update'
    const context = {
      status: p.status,
      attempt: p.attempt,
      nextRetryInMs: p.nextRetryInMs,
      error: p.error,
      close: p.close,
      url: p.url,
    }

    if (level === 'error') {
      log.error(message, context)
    } else if (level === 'warn') {
      log.warn(message, context)
    } else {
      log.info(message, context)
    }
  })

  // Renderer React crash report — the root error boundary forwards the thrown
  // error and component stack here so it lands in main.log even though the
  // renderer tree is already in a failed state. Read the file once to get the
  // exact component that threw; refresh resets the tree.
  ipcMain.on('__renderer:crash', (_event, payload: unknown) => {
    log.error('[renderer-crash] Root React tree crashed', payload)
  })

  // Dialog bridge — preload capability handlers use ipcRenderer.invoke to
  // call main-process-only dialog APIs (dialog, BrowserWindow).
  ipcMain.handle('__dialog:showMessageBox', async (event, spec) => {
    const win = BrowserWindow.fromWebContents(event.sender)
      || BrowserWindow.getFocusedWindow()
      || BrowserWindow.getAllWindows()[0]
    const result = await dialog.showMessageBox(win, spec)
    return { response: result.response }
  })
}
