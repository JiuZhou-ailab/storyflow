// input: Renderer menu sources that expose or intentionally omit manual update checks
// output: Regression coverage for feedback-aware update entrypoints and the simplified activity sidebar
// pos: Guards update actions without reintroducing a standalone sidebar control

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

  it('keeps manual updates out of the activity sidebar profile menu', () => {
    const railSource = source('../../components/app-shell/ActivityRail.tsx')

    expect(railSource).not.toContain('useUpdateChecker')
    expect(railSource).not.toContain('getUpdateIndicatorState')
    expect(railSource).not.toContain('activity-check-updates')
    expect(railSource).toContain('data-tutorial="activity-profile"')
    expect(railSource).toContain('data-tutorial="activity-whats-new"')
    expect(railSource).toContain("whatsNew?.unseen ? '新功能（未读）' : '新功能'")
  })
})
