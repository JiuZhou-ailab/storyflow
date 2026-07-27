// input: Renderer panel chrome and menu sources for workspace and update actions
// output: Regression coverage for the right-workspace toggle and remaining update entrypoint
// pos: Guards title-bar ownership without reintroducing a standalone update control

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf-8')
}

describe('manual update check entrypoints', () => {
  it('keeps the right workspace action in panel chrome instead of update checks', () => {
    const appShellSource = source('../../components/app-shell/AppShell.tsx')

    expect(appShellSource).toContain('const rightWorkspaceToggleButton = React.useMemo')
    expect(appShellSource).toContain('PanelRightClose')
    expect(appShellSource).not.toContain('useUpdateChecker')
    expect(appShellSource).not.toContain('checkForUpdates')
    expect(appShellSource).not.toContain('<TopBar')
    expect(appShellSource).toContain('setRightWorkspaceVisible((visible) => !visible)')
    expect(appShellSource).toContain('writingDocumentSurface && rightWorkspaceVisible && !isAutoCompact')
    expect(appShellSource).toContain(
      'activityWorkspaceDirectory && rightWorkspaceVisible && !isAutoCompact',
    )
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
