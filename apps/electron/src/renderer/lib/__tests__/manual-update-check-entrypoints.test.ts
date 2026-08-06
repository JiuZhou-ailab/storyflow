// input: Renderer root, panel chrome, sidebar, and settings update source
// output: Regression coverage for one global update owner and its persistent sidebar affordance
// pos: Guards update ownership without reintroducing route-scoped updater controllers

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
    expect(appShellSource).not.toContain('checkForUpdates')
    expect(appShellSource).not.toContain('<TopBar')
    expect(appShellSource).toContain('setRightWorkspaceVisible((visible) => !visible)')
    expect(appShellSource).toContain(
      'activeWritingDocumentSurface && rightWorkspaceVisible && canPresentConversationDiffInWorkspace',
    )
    expect(appShellSource).toContain('const showWorkspaceDirectoryColumn = Boolean(')
    expect(appShellSource).not.toContain('&& !conversationDiffSurface')
  })

  it('routes manual update checks through the feedback-aware hook', () => {
    const settingsSource = source('../../pages/settings/AppSettingsPage.tsx')

    expect(settingsSource).toContain('await updateChecker.checkForUpdates()')
    expect(settingsSource).not.toContain('window.electronAPI.checkForUpdates()')
  })

  it('mounts one global update owner and keeps update readiness separate from release notes', () => {
    const mainSource = source('../../main.tsx')
    const railSource = source('../../components/app-shell/ActivityRail.tsx')

    expect(mainSource.match(/<UpdateCheckerProvider>/g)).toHaveLength(1)
    expect(railSource).not.toContain('useUpdateChecker')
    expect(railSource).not.toContain('getUpdateIndicatorState')
    expect(railSource).not.toContain('activity-check-updates')
    expect(railSource).toContain('data-tutorial="activity-update"')
    expect(railSource).toContain('aria-live="polite"')
    expect(railSource).toContain('data-tutorial="activity-profile"')
    expect(railSource).toContain('data-tutorial="activity-whats-new"')
    expect(railSource).toContain("whatsNew?.unseen ? '新功能（未读）' : '新功能'")
  })
})
