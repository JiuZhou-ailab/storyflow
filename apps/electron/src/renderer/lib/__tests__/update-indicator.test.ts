// input: Auto-update state snapshots from the Electron main process
// output: Regression coverage for the top-bar update indicator visibility contract
// pos: Guards renderer update affordance state derivation

import { describe, expect, it } from 'bun:test'
import type { UpdateInfo } from '../../../shared/types'
import {
  getUpdateIndicatorState,
  shouldRunScheduledUpdateCheck,
} from '../update-indicator'

function updateInfo(downloadState: UpdateInfo['downloadState'], overrides: Partial<UpdateInfo> = {}): UpdateInfo {
  return {
    available: false,
    currentVersion: '1.0.0',
    latestVersion: null,
    downloadState,
    downloadProgress: 0,
    ...overrides,
  }
}

describe('getUpdateIndicatorState', () => {
  it('does not show an indicator when no actionable update state exists', () => {
    expect(getUpdateIndicatorState(null)).toBeNull()
    expect(getUpdateIndicatorState(updateInfo('idle'))).toBeNull()
    expect(getUpdateIndicatorState(updateInfo('error'))).toBeNull()
  })

  it('shows passive progress while an update is downloading', () => {
    expect(getUpdateIndicatorState(updateInfo('downloading', {
      available: true,
      latestVersion: '1.1.0',
      downloadProgress: 42,
    }))).toEqual({
      kind: 'downloading',
      version: '1.1.0',
      progress: 42,
      actionable: false,
    })
  })

  it('shows an actionable restart entry when an update is ready', () => {
    expect(getUpdateIndicatorState(updateInfo('ready', {
      available: true,
      latestVersion: '1.1.0',
      downloadProgress: 100,
    }))).toEqual({
      kind: 'ready',
      version: '1.1.0',
      progress: 100,
      actionable: true,
    })
  })

  it('keeps the indicator visible but disabled during installation', () => {
    expect(getUpdateIndicatorState(updateInfo('installing', {
      available: true,
      latestVersion: '1.1.0',
      downloadProgress: 100,
    }))).toEqual({
      kind: 'installing',
      version: '1.1.0',
      progress: 100,
      actionable: false,
    })
  })
})

describe('shouldRunScheduledUpdateCheck', () => {
  it('runs scheduled checks only for packaged builds after the interval expires', () => {
    const sixHours = 6 * 60 * 60 * 1000

    expect(shouldRunScheduledUpdateCheck({
      now: 12 * 60 * 60 * 1000,
      lastCheckedAt: 0,
      intervalMs: sixHours,
      isPackaged: true,
    })).toBe(true)

    expect(shouldRunScheduledUpdateCheck({
      now: 60 * 1000,
      lastCheckedAt: 0,
      intervalMs: sixHours,
      isPackaged: true,
    })).toBe(false)

    expect(shouldRunScheduledUpdateCheck({
      now: 12 * 60 * 60 * 1000,
      lastCheckedAt: 0,
      intervalMs: sixHours,
      isPackaged: false,
    })).toBe(false)
  })

  it('runs the first scheduled packaged check when there is no previous timestamp', () => {
    expect(shouldRunScheduledUpdateCheck({
      now: 1,
      lastCheckedAt: null,
      intervalMs: 6 * 60 * 60 * 1000,
      isPackaged: true,
    })).toBe(true)
  })
})
