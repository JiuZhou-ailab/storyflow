// Runs in real Electron; the native recovery choice is observed without dismissing a human's dialogs.
import { app } from 'electron'
import { WindowManager } from '../../apps/electron/src/main/window-manager'
import { recordStartupFailure } from '../../apps/electron/src/main/startup-recovery'
app.setPath('userData', process.env.STARTUP_FIXTURE_ROOT!)
let rejections = 0
process.on('unhandledRejection', () => { rejections++ })
app.whenReady().then(() => {
  let failures = 0
  const manager = new WindowManager(error => {
    failures++
    const receipt = recordStartupFailure(error, 'window')
    setTimeout(() => {
      console.log('STARTUP_RESULT=' + JSON.stringify({ failures, rejections, visible: win.isVisible(), code: (error as NodeJS.ErrnoException).code, receipt }))
      app.exit(failures === 1 && rejections === 0 && win.isVisible() ? 0 : 1)
    }, 300)
  })
  const win = manager.createWindow({ workspaceId: '' })
  if (process.env.STARTUP_FIXTURE_CASE === 'crash') win.webContents.once('did-finish-load', () => win.webContents.forcefullyCrashRenderer())
  setTimeout(() => app.exit(2), 10_000)
})
