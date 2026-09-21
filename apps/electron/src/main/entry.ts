// input: Electron plus the asynchronously loaded Product Host main module
// output: Native diagnostics even when a bundled dependency fails to initialize
// pos: Minimal process entry; ordinary startup/quit remains owned by index.ts
import { app, clipboard, dialog, shell } from 'electron'
import { setupI18n, i18n } from '@craft-agent/shared/i18n'
import { recordStartupFailure } from './startup-diagnostics'
import { getStartupRecoveryDownloadUrl } from './startup-state'

void import('./index').catch(async error => {
  await app.whenReady()
  const receipt = recordStartupFailure(error, 'main-module')
  if (process.env.CRAFT_HEADLESS) { app.exit(1); return }
  setupI18n()
  for (;;) {
    const { response } = await dialog.showMessageBox({ type: 'error', title: i18n.t('startup.title'),
      message: i18n.t('startup.reason.initialization'), detail: receipt,
      buttons: [i18n.t('startup.action.download'), i18n.t('startup.action.copy'), i18n.t('startup.action.close')],
      cancelId: 2, noLink: true })
    if (response === 1) { clipboard.writeText(receipt); continue }
    if (response === 0) {
      try { await shell.openExternal(getStartupRecoveryDownloadUrl(process.platform, process.arch)) }
      catch (cause) { recordStartupFailure(cause, 'recovery-download') }
      continue
    }
    app.exit(1)
    return
  }
})
