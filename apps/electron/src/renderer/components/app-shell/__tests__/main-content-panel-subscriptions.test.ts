// input: MainContentPanel and AppShellContext source
// output: Regression coverage for main content panel app-shell subscription boundaries
// pos: Keeps batch session chrome off broad app-shell updates

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const mainContentPanelSource = readFileSync(new URL('../MainContentPanel.tsx', import.meta.url), 'utf-8')
const panelSlotSource = readFileSync(new URL('../PanelSlot.tsx', import.meta.url), 'utf-8')
const appShellContextSource = readFileSync(new URL('../../../context/AppShellContext.tsx', import.meta.url), 'utf-8')

describe('MainContentPanel subscriptions', () => {
  it('uses a narrow batch session action context', () => {
    expect(mainContentPanelSource).not.toContain('useAppShellContext')
    expect(mainContentPanelSource).toContain('useSessionBatchActions')
    expect(appShellContextSource).toContain('SessionBatchActionsContext')
  })

  it('keeps panel chrome overrides off the broad app shell context', () => {
    expect(panelSlotSource).not.toContain('useAppShellContext')
    expect(panelSlotSource).not.toContain('AppShellProvider')
    expect(panelSlotSource).toContain('SessionPanelChromeProvider')
    expect(appShellContextSource).toContain('SessionPanelChromeProvider')
  })

  it('keeps full workspace-list reads out of the main content router', () => {
    const mainContentPanelBody = mainContentPanelSource.slice(
      mainContentPanelSource.indexOf('export function MainContentPanel'),
      mainContentPanelSource.indexOf('function SendResourceWorkspaceDialogHost')
    )

    expect(mainContentPanelBody).not.toContain('useAtomValue(windowWorkspacesAtom)')
    expect(mainContentPanelSource).toContain('SendResourceWorkspaceDialogHost')
  })

  it('keeps batch session actions off whole metadata-map updates', () => {
    const batchPanelSource = mainContentPanelSource.slice(
      mainContentPanelSource.indexOf('function SessionBatchActionsPanel'),
      mainContentPanelSource.indexOf('function SessionRouteContent')
    )

    expect(batchPanelSource).toContain('useSelectedSessionMetas')
    expect(batchPanelSource).not.toContain('useAtomValue(sessionMetaMapAtom)')
  })
})
