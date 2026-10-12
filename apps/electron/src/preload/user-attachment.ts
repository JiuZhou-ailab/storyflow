// input: Native File objects received through the isolated context bridge
// output: Synchronously authorized OS attachment paths or null for synthetic files
// pos: Trusted preload boundary for renderer file attachments
import { ipcRenderer, webUtils } from 'electron'

export function getUserAttachmentPath(file: File): string | null {
  try {
    const path = webUtils.getPathForFile(file)
    if (!path) return null
    // Registration must finish before renderer code can issue the attachment read RPC.
    return ipcRenderer.sendSync('__files:registerUserAttachment', path) ? path : null
  } catch {
    return null
  }
}
