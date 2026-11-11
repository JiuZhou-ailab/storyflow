// input: A packaged app with startup-gate update isolation enabled
// output: Proof that launch/manual checks, cached downloads, and install requests cannot replace the app
// pos: Regression guard for #79, isolated from the enabled updater tests
import { expect, mock, test } from 'bun:test'
import { EventEmitter } from 'node:events'

const updater = Object.assign(new EventEmitter(), {
  autoDownload: true,
  autoInstallOnAppQuit: true,
  // Even an already validated cached installer must not run.
  downloadedUpdateHelper: { file: 'cached-installer', versionInfo: { version: '999.0.0' } },
  checkForUpdates: mock(async () => ({ updateInfo: { version: '999.0.0' } })),
  quitAndInstall: mock(() => {}),
})
mock.module('electron-updater', () => ({ autoUpdater: updater }))
mock.module('electron', () => ({ app: { isPackaged: true } }))
mock.module('../logger', () => ({ mainLog: { info() {}, warn() {}, error() {} } }))
mock.module('@craft-agent/shared/version', () => ({ getAppVersion: () => '0.26.2' }))
mock.module('@craft-agent/shared/config', () => ({
  getDismissedUpdateVersion: () => null, clearDismissedUpdateVersion() {},
}))

process.env.CRAFT_DISABLE_AUTO_UPDATE = '1'
const updates = await import('../auto-update')
delete process.env.CRAFT_DISABLE_AUTO_UPDATE

test('startup isolation blocks all update entry points and native install-on-quit', async () => {
  expect(updater.autoDownload).toBe(false)
  expect(updater.autoInstallOnAppQuit).toBe(false)
  expect(await updates.checkForUpdatesOnLaunch()).toEqual({ action: 'skipped', reason: 'disabled' })
  expect((await updates.checkForUpdates()).available).toBe(false)
  expect((await updates.checkForUpdates({ autoDownload: false })).available).toBe(false)
  await expect(updates.installUpdate()).rejects.toThrow('Updates are disabled')
  expect(updater.checkForUpdates).not.toHaveBeenCalled()
  expect(updater.quitAndInstall).not.toHaveBeenCalled()
})
