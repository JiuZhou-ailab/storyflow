// input: AutomationInfoPage source and known hosts
// output: Regression coverage for automation detail subscription boundaries
// pos: Keeps automation detail views off broad workspace context updates

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const infoPageSource = readFileSync(new URL('../AutomationInfoPage.tsx', import.meta.url), 'utf-8')
const settingsPageSource = readFileSync(new URL('../../../pages/settings/AutomationsSettingsPage.tsx', import.meta.url), 'utf-8')
const mainContentSource = readFileSync(new URL('../../app-shell/MainContentPanel.tsx', import.meta.url), 'utf-8')
const mainContentPanelSource = mainContentSource.slice(
  mainContentSource.indexOf('export function MainContentPanel'),
  mainContentSource.indexOf('function SessionBatchActionsPanel'),
)

describe('AutomationInfoPage subscriptions', () => {
  it('receives workspace root path from callers instead of app shell context', () => {
    expect(infoPageSource).not.toContain('useActiveWorkspace')
    expect(infoPageSource).not.toContain('useAppShellContext')
    expect(infoPageSource).toContain('workspaceRootPath?: string')
  })

  it('passes workspace root path from settings and main content hosts', () => {
    expect(settingsPageSource).toContain('workspaceRootPath={workspace.rootPath}')
    expect(mainContentSource).toContain('workspaceRootPath={activeWorkspace?.rootPath}')
  })

  it('keeps the main content automation route off broad app shell context', () => {
    expect(mainContentPanelSource).not.toContain('useAppShellContext')
    expect(mainContentPanelSource).toContain('windowWorkspaceIdAtom')
    expect(mainContentPanelSource).toContain('windowWorkspacesAtom')
    expect(mainContentPanelSource).toContain('useAutomationActions(')
    expect(mainContentPanelSource).toContain('automationPendingDelete')
    expect(mainContentPanelSource).toContain('pendingDeleteAutomation')
    expect(mainContentPanelSource).toContain('confirmDeleteAutomation')
    expect(mainContentPanelSource).toContain('setAutomationPendingDelete')
    expect(mainContentPanelSource).toContain('dialog.deleteAutomation.title')
  })
})
