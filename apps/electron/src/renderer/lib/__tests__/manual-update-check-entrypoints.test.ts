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

  it('routes activity rail update control through the feedback-aware hook', () => {
    const railSource = source('../../components/app-shell/ActivityRail.tsx')

    expect(railSource).toContain('useUpdateChecker')
    expect(railSource).toContain('getUpdateIndicatorState')
    expect(railSource).toContain('void updateChecker.checkForUpdates()')
    expect(railSource).toContain('void updateChecker.installUpdate()')
    expect(railSource).toContain('dataTutorial="activity-check-updates"')
    expect(railSource).toContain('onClick={handleUpdateClick}')
    // Release notes remain a separate secondary control.
    expect(railSource).toContain('dataTutorial="activity-whats-new"')
    expect(railSource).toContain("label={whatsNew?.unseen ? '新功能（未读）' : '新功能'}")
  })
})
