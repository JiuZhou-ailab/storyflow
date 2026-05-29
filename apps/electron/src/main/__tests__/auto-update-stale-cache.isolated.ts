// input: Simulated electron-updater events and a local updater cache directory
// output: Regression coverage for stale pending update cache handling
// pos: Guards the main-process updater against treating old downloads as ready

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { EventEmitter } from 'node:events'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

mock.module('@craft-agent/shared/version', () => ({
  getAppVersion: () => '0.9.23',
}))

mock.module('@craft-agent/shared/config', () => ({
  clearDismissedUpdateVersion: mock(() => {}),
  getDismissedUpdateVersion: mock(() => null),
}))

const tempDirs: string[] = []

afterEach(() => {
  isPackaged = true
  autoUpdater.checkForUpdates.mockClear()

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
})
