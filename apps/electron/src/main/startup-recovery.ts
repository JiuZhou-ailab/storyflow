// input: Startup/window failures and the native Electron lifecycle
// output: Bounded redacted receipts and renderer-independent recovery choices
// pos: Last usable recovery surface when Host RPC or app assets cannot load
import { clipboard, dialog, shell } from 'electron'
import { i18n } from '@craft-agent/shared/i18n'
import { listStoredConfigBackups } from '@craft-agent/shared/config'
import { getStartupRecoveryDownloadUrl } from './startup-state'
import { STARTUP_CATEGORIES, recordStartupFailure } from './startup-diagnostics'
export { recordStartupFailure } from './startup-diagnostics'

export async function showStartupRecovery(error: unknown, stage: string): Promise<{ restart: boolean; backup?: string }> {
  const category = STARTUP_CATEGORIES[(error as { code?: string })?.code ?? ''] ?? 'initialization'
  const receipt = recordStartupFailure(error, stage)
  const backups = category === 'configInvalid' ? listStoredConfigBackups() : []
  const actions = ['retry', 'copy', ...(backups.length ? ['restore'] : []), ...(category === 'renderer' ? ['download'] : []), 'close']
  for (;;) {
    const result = await dialog.showMessageBox({ type: 'error', title: i18n.t('startup.title'),
      message: i18n.t(`startup.reason.${category}`), detail: `${i18n.t('startup.dataPreserved')}\n\n${receipt}`,
      buttons: actions.map(action => i18n.t(`startup.action.${action}`)),
      defaultId: 0, cancelId: actions.length - 1, noLink: true,
    })
    const action = actions[result.response]
    if (action === 'copy') { clipboard.writeText(receipt); continue }
    if (action === 'download') {
      try { await shell.openExternal(getStartupRecoveryDownloadUrl(process.platform, process.arch)) }
      catch (cause) { recordStartupFailure(cause, 'recovery-download') }
      continue
    }
    if (action === 'restore') {
      const choice = await dialog.showMessageBox({ type: 'warning', title: i18n.t('startup.action.restore'),
        message: i18n.t('startup.restoreConfirmation'), buttons: [...backups, i18n.t('common.cancel')],
        cancelId: backups.length, defaultId: backups.length, noLink: true })
      if (choice.response < backups.length) return { restart: true, backup: backups[choice.response] }
      continue
    }
    return { restart: action === 'retry' }
  }
}
