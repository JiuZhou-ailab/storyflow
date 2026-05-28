// input: Manual update check results from the auto-update service
// output: Dialog view-model coverage for native menu feedback
// pos: Keeps macOS native update checks from silently discarding user-visible results

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { UpdateInfo } from '../../shared/types'
import { getManualUpdateCheckDialog } from '../manual-update-check'

function updateInfo(overrides: Partial<UpdateInfo>): UpdateInfo {
  return {
    available: false,
    currentVersion: '1.2.3',
    latestVersion: null,
    downloadState: 'idle',
    downloadProgress: 0,
    ...overrides,
  }
}

describe('getManualUpdateCheckDialog', () => {
  it('shows up-to-date feedback when no update is available', () => {
    expect(getManualUpdateCheckDialog(updateInfo({}))).toEqual({
      type: 'info',
      message: "You're up to date",
      detail: 'Version 1.2.3 is the latest.',
    })
  })

  it('shows error feedback when update checking fails', () => {
    expect(getManualUpdateCheckDialog(updateInfo({
      downloadState: 'error',
      error: 'feed unavailable',
    }))).toEqual({
      type: 'error',
      message: 'Failed to check for updates',
      detail: 'feed unavailable',
    })
  })

  it('shows ready feedback when an update is already ready to install', () => {
    expect(getManualUpdateCheckDialog(updateInfo({
      available: true,
      latestVersion: '1.2.4',
      downloadState: 'ready',
      downloadProgress: 100,
    }))).toEqual({
      type: 'info',
      message: 'Update v1.2.4 ready',
      detail: 'Restart to apply the update.',
    })
  })

  it('does not interrupt when the update is still downloading', () => {
    expect(getManualUpdateCheckDialog(updateInfo({
      available: true,
      latestVersion: '1.2.4',
      downloadState: 'downloading',
      downloadProgress: 12,
    }))).toBeNull()
  })
})

describe('native menu manual update check', () => {
  it('shows feedback for completed manual checks', () => {
    const menuSource = readFileSync(new URL('../menu.ts', import.meta.url), 'utf-8')

    expect(menuSource).toContain('getManualUpdateCheckDialog')
    expect(menuSource).toContain('await showManualUpdateCheckResult(info)')
  })
})
