// input: Renderer menu source that exposes manual update checks
// output: Regression coverage that manual update checks use the feedback-aware hook
// pos: Guards user-visible update check entrypoints from silently discarding IPC results

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf-8')
}

describe('manual update check entrypoints', () => {
  it('routes top bar manual update checks through the feedback-aware hook', () => {
    const topBarSource = source('../../components/app-shell/TopBar.tsx')

    expect(topBarSource).toContain('void updateChecker.checkForUpdates()')
    expect(topBarSource).not.toContain('window.electronAPI.checkForUpdates()')
  })

  it('routes legacy app menu manual update checks through the feedback-aware hook', () => {
    const appMenuSource = source('../../components/AppMenu.tsx')

    expect(appMenuSource).toContain('void updateChecker.checkForUpdates()')
    expect(appMenuSource).not.toContain('window.electronAPI.checkForUpdates()')
  })
})
