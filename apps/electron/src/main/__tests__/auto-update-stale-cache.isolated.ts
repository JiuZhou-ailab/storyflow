// input: Updater events, a local cache, and main-process document exit preparation
// output: Regression coverage for stale downloads and retryable install cancellation
// pos: Guards main-process download validation and native installer handoff

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { EventEmitter } from 'node:events'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { createQuitCoordinator } from '../quit-coordinator'

let homeDir = ''
let isPackaged = true

const logger = {
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
}

const latestUpdateInfo = {
  version: '0.9.24',
  files: [
    {
      url: 'Storyflow-arm64.zip',
      sha512: 'new-release-sha512',
      size: 230775932,
    },
  ],
  path: 'Storyflow-arm64.zip',
  sha512: 'new-release-sha512',
  releaseDate: '2026-05-29T05:47:26.158Z',
}

class MockAutoUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = false
  logger: unknown = null
  downloadedUpdateHelper: { versionInfo?: { version?: string } } | null = null

  checkForUpdates = mock(async () => {
    this.emit('checking-for-update')
    this.emit('update-available', latestUpdateInfo)
    return { updateInfo: latestUpdateInfo }
  })

  quitAndInstall = mock(() => {})
}

const autoUpdater = new MockAutoUpdater()

mock.module('electron-updater', () => ({
  autoUpdater,
}))

mock.module('electron', () => ({
  app: {
    get isPackaged() {
      return isPackaged
    },
    getName: () => 'Storyflow',
    getPath: (name: string) => {
      if (name === 'home') return homeDir
      return join(homeDir, name)
    },
  },
}))

mock.module('../logger', () => ({
  mainLog: logger,
}))

mock.module('../menu', () => ({
  rebuildMenu: mock(() => {}),
}))

mock.module('@craft-agent/shared/version', () => ({
  getAppVersion: () => '0.9.23',
}))

mock.module('@craft-agent/shared/config', () => ({
  clearDismissedUpdateVersion: mock(() => {}),
  getDismissedUpdateVersion: mock(() => null),
}))

const tempDirs: string[] = []

function markDownloadedThisSession(version = latestUpdateInfo.version): void {
  autoUpdater.downloadedUpdateHelper = { versionInfo: { version } }
}

afterEach(() => {
  isPackaged = true
  autoUpdater.downloadedUpdateHelper = null
  autoUpdater.checkForUpdates.mockClear()
  autoUpdater.quitAndInstall.mockReset()

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function createStalePendingDownload(): void {
  const pendingDir = join(homeDir, 'Library', 'Caches', 'Storyflow-updater', 'pending')
  mkdirSync(pendingDir, { recursive: true })
  writeFileSync(
    join(pendingDir, 'update-info.json'),
    JSON.stringify({
      fileName: 'Storyflow-arm64.zip',
      sha512: 'old-release-sha512',
      isAdminRightsRequired: false,
    }),
  )
  writeFileSync(join(pendingDir, 'Storyflow-arm64.zip'), 'old release archive')
}

describe('auto-update stale cache handling', () => {
  it('returns an error instead of a false up-to-date result in dev runtime', async () => {
    homeDir = join(tmpdir(), `storyflow-update-dev-${Date.now()}`)
    tempDirs.push(homeDir)
    isPackaged = false

    const { checkForUpdates } = await import('../auto-update')

    const info = await checkForUpdates({ autoDownload: true })

    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    expect(info).toMatchObject({
      available: false,
      currentVersion: '0.9.23',
      downloadState: 'error',
    })
    expect(info.error).toContain('packaged')
  })

  it('does not mark a mismatched pending download as ready for the latest update', async () => {
    homeDir = join(tmpdir(), `storyflow-update-cache-${Date.now()}`)
    tempDirs.push(homeDir)
    createStalePendingDownload()

    const { checkForUpdates } = await import('../auto-update')

    const info = await checkForUpdates({ autoDownload: true })

    expect(info).toMatchObject({
      available: true,
      latestVersion: '0.9.24',
      downloadState: 'downloading',
      downloadProgress: 0,
    })
  })

  it('finishes application cleanup before handing off to the native updater', async () => {
    const order: string[] = []
    const {
      installUpdate,
      isUpdating,
      setUpdateInstallPreparation,
    } = await import('../auto-update')
    setUpdateInstallPreparation(async () => { order.push('prepare') })
    autoUpdater.quitAndInstall.mockImplementation(() => { order.push('install') })
    markDownloadedThisSession()
    autoUpdater.emit('update-downloaded', latestUpdateInfo)

    await installUpdate()

    expect(order).toEqual(['prepare', 'install'])
    expect(isUpdating()).toBe(true)
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('broadcasts ready after document cancellation and allows installing again', async () => {
    const updater = await import('../auto-update')
    const broadcasts: string[] = []
    updater.setAutoUpdateEventSink((_channel, _target, info) => {
      broadcasts.push((info as { downloadState: string }).downloadState)
    })
    let approved = false
    const prepare = mock(async () => {})
    const index = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
    const preparation = index.slice(index.indexOf('const DOCUMENT_LEAVE_TIMEOUT_MS'), index.indexOf('let checkingDocumentQuit'))
    runInNewContext(new Bun.Transpiler({ loader: 'ts' }).transformSync(preparation), {
      ...updater,
      setTimeout,
      clearTimeout,
      BrowserWindow: { getAllWindows: () => [{ webContents: {
        isDestroyed: () => false,
        isLoading: () => false,
        executeJavaScript: async () => approved,
      } }] },
      quitCoordinator: createQuitCoordinator({ isUpdating: updater.isUpdating, prepare, exit() {} }),
    })
    markDownloadedThisSession()
    autoUpdater.emit('update-downloaded', latestUpdateInfo)

    await expect(updater.installUpdate()).rejects.toThrow('Update cancelled: unsaved document')

    expect(updater.getUpdateInfo().downloadState).toBe('ready')
    expect(broadcasts).toEqual(['ready', 'installing', 'ready'])
    expect(updater.isUpdating()).toBe(false)
    expect(prepare).not.toHaveBeenCalled()
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled()

    approved = true
    await updater.installUpdate()

    expect(prepare).toHaveBeenCalledTimes(1)
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
    expect(updater.isUpdating()).toBe(true)
  })

  it.each(['preparation', 'installer'])('keeps genuine %s failures in error state', async (failureAt) => {
    const updater = await import('../auto-update')
    // Identical text must not turn an ordinary failure into a user cancellation.
    const failure = new Error('Update cancelled: unsaved document')
    const broadcasts: string[] = []
    updater.setAutoUpdateEventSink((_channel, _target, info) => {
      broadcasts.push((info as { downloadState: string }).downloadState)
    })
    updater.setUpdateInstallPreparation(async () => {
      if (failureAt === 'preparation') throw failure
    })
    autoUpdater.quitAndInstall.mockImplementation(() => { throw failure })
    markDownloadedThisSession()
    autoUpdater.emit('update-downloaded', latestUpdateInfo)

    await expect(updater.installUpdate()).rejects.toBe(failure)

    expect(updater.getUpdateInfo().downloadState).toBe('error')
    expect(broadcasts).toEqual(['ready', 'installing', 'error'])
    expect(updater.isUpdating()).toBe(false)
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(failureAt === 'installer' ? 1 : 0)
  })

  it('does not tear down the app when this session has no validated installer', async () => {
    const { installUpdate, isUpdating, setUpdateInstallPreparation } = await import('../auto-update')
    const prepare = mock(async () => {})
    setUpdateInstallPreparation(prepare)
    autoUpdater.emit('update-downloaded', latestUpdateInfo)

    await expect(installUpdate()).rejects.toThrow('No validated update file is available to install')

    expect(prepare).not.toHaveBeenCalled()
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled()
    expect(isUpdating()).toBe(false)
  })

  it('does not treat a cached file without a checksum as downloaded', async () => {
    homeDir = join(tmpdir(), `storyflow-update-nosha-${Date.now()}`)
    tempDirs.push(homeDir)
    const pendingDir = join(homeDir, 'Library', 'Caches', 'Storyflow-updater', 'pending')
    mkdirSync(pendingDir, { recursive: true })
    writeFileSync(join(pendingDir, 'update-info.json'), JSON.stringify({
      fileName: 'Storyflow-arm64.zip',
      isAdminRightsRequired: false,
    }))
    writeFileSync(join(pendingDir, 'Storyflow-arm64.zip'), 'unverified archive')

    const { checkForUpdates } = await import('../auto-update')
    const info = await checkForUpdates({ autoDownload: true })

    expect(info).toMatchObject({
      available: true,
      latestVersion: '0.9.24',
      downloadState: 'downloading',
    })
  })
})
