// input: Automation menu/list sources
// output: Regression coverage for workspace subscription boundaries
// pos: Keeps automation actions off broad app shell context updates

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const batchAutomationMenuSource = readFileSync(new URL('../BatchAutomationMenu.tsx', import.meta.url), 'utf-8')
const automationsListPanelSource = readFileSync(new URL('../AutomationsListPanel.tsx', import.meta.url), 'utf-8')

describe('batch automation menu subscriptions', () => {
  it('reads active workspace id from the shared workspace atom', () => {
    expect(batchAutomationMenuSource).toContain('windowWorkspaceIdAtom')
    expect(batchAutomationMenuSource).toContain('useAtomValue(windowWorkspaceIdAtom)')
    expect(batchAutomationMenuSource).not.toContain('useAppShellContext')
  })

  it('keeps the automations list off broad app shell context subscriptions', () => {
    expect(automationsListPanelSource).not.toContain('useAppShellContext')
    expect(automationsListPanelSource).toContain('workspaces = []')
    expect(automationsListPanelSource).toContain('activeWorkspaceId = null')
  })
})
