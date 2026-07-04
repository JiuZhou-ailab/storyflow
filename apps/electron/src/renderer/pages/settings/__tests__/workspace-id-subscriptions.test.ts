// input: Workspace-scoped settings page source
// output: Regression coverage for workspace id subscription boundaries
// pos: Keeps settings pages off broad app shell context when only the workspace id is needed

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const labelsPageSource = readFileSync(new URL('../LabelsSettingsPage.tsx', import.meta.url), 'utf-8')
const permissionsPageSource = readFileSync(new URL('../PermissionsSettingsPage.tsx', import.meta.url), 'utf-8')
const appearancePageSource = readFileSync(new URL('../AppearanceSettingsPage.tsx', import.meta.url), 'utf-8')
const workspacePageSource = readFileSync(new URL('../WorkspaceSettingsPage.tsx', import.meta.url), 'utf-8')
const automationsPageSource = readFileSync(new URL('../AutomationsSettingsPage.tsx', import.meta.url), 'utf-8')

describe('workspace id settings subscriptions', () => {
  it('keeps labels settings off the broad app shell context', () => {
    expect(labelsPageSource).not.toContain('useAppShellContext')
    expect(labelsPageSource).not.toContain('useActiveWorkspace')
    expect(labelsPageSource).toContain('windowWorkspaceIdAtom')
    expect(labelsPageSource).toContain('workspacePanelFieldsAtomFamily')
    expect(labelsPageSource).toContain('useAtomValue(windowWorkspaceIdAtom)')
    expect(labelsPageSource).toContain('useAtomValue(workspacePanelFieldsAtomFamily(activeWorkspaceId ?? null))')
  })

  it('keeps permissions settings off the broad app shell context', () => {
    expect(permissionsPageSource).not.toContain('useAppShellContext')
    expect(permissionsPageSource).not.toContain('useActiveWorkspace')
    expect(permissionsPageSource).toContain('windowWorkspaceIdAtom')
    expect(permissionsPageSource).toContain('workspacePanelFieldsAtomFamily')
    expect(permissionsPageSource).toContain('useAtomValue(windowWorkspaceIdAtom)')
    expect(permissionsPageSource).toContain('useAtomValue(workspacePanelFieldsAtomFamily(activeWorkspaceId ?? null))')
  })

  it('keeps appearance settings workspace list off the broad app shell context', () => {
    expect(appearancePageSource).not.toContain('useAppShellContext')
    expect(appearancePageSource).toContain('windowWorkspacesAtom')
    expect(appearancePageSource).toContain('useAtomValue(windowWorkspacesAtom)')
  })

  it('keeps workspace settings off the broad app shell context', () => {
    expect(workspacePageSource).not.toContain('useAppShellContext')
    expect(workspacePageSource).toContain('windowWorkspaceIdAtom')
    expect(workspacePageSource).toContain('useAtomValue(windowWorkspaceIdAtom)')
    expect(workspacePageSource).toContain('windowWorkspacesAtom')
    expect(workspacePageSource).toContain('useSetAtom(windowWorkspacesAtom)')
  })

  it('keeps automations settings off the broad app shell context', () => {
    expect(automationsPageSource).not.toContain('useAppShellContext')
    expect(automationsPageSource).not.toContain('useActiveWorkspace')
    expect(automationsPageSource).toContain('windowWorkspaceIdAtom')
    expect(automationsPageSource).toContain('useAtomValue(windowWorkspaceIdAtom)')
    expect(automationsPageSource).toContain('workspacePanelFieldsAtomFamily')
    expect(automationsPageSource).toContain('useAtomValue(workspacePanelFieldsAtomFamily(activeWorkspaceId ?? null))')
    expect(automationsPageSource).toContain('windowWorkspacesAtom')
    expect(automationsPageSource).toContain('useAtomValue(windowWorkspacesAtom)')
    expect(automationsPageSource).toContain('useAutomationActions(')
  })
})
