// input: Workspace-scoped settings page source
// output: Regression coverage for workspace id subscription boundaries
// pos: Keeps settings pages off broad app shell context when only the workspace id is needed

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const labelsPageSource = readFileSync(new URL('../LabelsSettingsPage.tsx', import.meta.url), 'utf-8')
const permissionsPageSource = readFileSync(new URL('../PermissionsSettingsPage.tsx', import.meta.url), 'utf-8')
const appearancePageSource = readFileSync(new URL('../AppearanceSettingsPage.tsx', import.meta.url), 'utf-8')

describe('workspace id settings subscriptions', () => {
  it('keeps labels settings off the broad app shell context', () => {
    expect(labelsPageSource).not.toContain('useAppShellContext')
    expect(labelsPageSource).toContain('windowWorkspaceIdAtom')
    expect(labelsPageSource).toContain('useAtomValue(windowWorkspaceIdAtom)')
  })

  it('keeps permissions settings off the broad app shell context', () => {
    expect(permissionsPageSource).not.toContain('useAppShellContext')
    expect(permissionsPageSource).toContain('windowWorkspaceIdAtom')
    expect(permissionsPageSource).toContain('useAtomValue(windowWorkspaceIdAtom)')
  })

  it('keeps appearance settings workspace list off the broad app shell context', () => {
    expect(appearancePageSource).not.toContain('useAppShellContext')
    expect(appearancePageSource).toContain('windowWorkspacesAtom')
    expect(appearancePageSource).toContain('useAtomValue(windowWorkspacesAtom)')
  })
})
