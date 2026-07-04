// input: MainContentPanel and AppShellContext source
// output: Regression coverage for main content panel app-shell subscription boundaries
// pos: Keeps batch session chrome off broad app-shell updates

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const mainContentPanelSource = readFileSync(new URL('../MainContentPanel.tsx', import.meta.url), 'utf-8')
const appShellContextSource = readFileSync(new URL('../../../context/AppShellContext.tsx', import.meta.url), 'utf-8')

describe('MainContentPanel subscriptions', () => {
  it('uses a narrow batch session action context', () => {
    expect(mainContentPanelSource).not.toContain('useAppShellContext')
    expect(mainContentPanelSource).toContain('useSessionBatchActions')
    expect(appShellContextSource).toContain('SessionBatchActionsContext')
  })
})
