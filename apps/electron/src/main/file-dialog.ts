// input: Isolated preload IPC and native Electron file selections
// output: Native file-dialog results and process-lifetime canonical attachment grants
// pos: Main-process trust boundary for native selections and isolated preload file provenance
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { initializeUserAttachmentAuthorization, registerTrustedUserAttachment } from '@craft-agent/server-core/handlers/rpc/user-attachment-access'

export function registerUserFileDialogHandlers(enforceLocalAuthorization = true): void {
  if (enforceLocalAuthorization) initializeUserAttachmentAuthorization()
  // No raw-path registration method is exposed to the renderer by contextBridge.
  ipcMain.on('__files:registerUserAttachment', (event, path: string) => {
    event.returnValue = event.senderFrame === event.sender.mainFrame
      && !!BrowserWindow.fromWebContents(event.sender)
      && registerTrustedUserAttachment(path)
  })
  ipcMain.handle('__dialog:showOpenDialog', async (event, spec) => {
    const win = BrowserWindow.fromWebContents(event.sender)
      || BrowserWindow.getFocusedWindow()
      || BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, spec)
    if (!result.canceled) {
      for (const path of result.filePaths) registerTrustedUserAttachment(path)
    }
    return { canceled: result.canceled, filePaths: result.filePaths }
  })
}
