// input: AppShell context source and window workspace atom wiring
// output: Regression coverage for broad app shell context removal
// pos: Keeps workspace-root consumers on atoms and narrow contexts

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const contextSource = readFileSync(new URL('../AppShellContext.tsx', import.meta.url), 'utf-8')
const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf-8')
const playgroundProviderSource = readFileSync(new URL('../../playground/PlaygroundAppShellProvider.tsx', import.meta.url), 'utf-8')

describe('active workspace subscriptions', () => {
  it('removes the broad app shell provider and broad workspace hooks', () => {
    expect(contextSource).not.toContain('const AppShellContext = createContext')
    expect(contextSource).not.toContain('<AppShellContext.Provider')
    expect(contextSource).not.toContain('useAppShellContext')
    expect(contextSource).not.toContain('useOptionalAppShellContext')
    expect(contextSource).not.toContain('useActiveWorkspace')
    expect(contextSource).toContain('SessionInteractionActionsContext')
    expect(contextSource).toContain('SessionPanelChromeContext')
  })

  it('keeps the real app and playground provider in sync with the workspace atoms', () => {
    expect(appSource).toContain('useAtom(windowWorkspacesAtom)')
    expect(appSource).toContain('useAtom(windowRuntimeWorkspaceAtom)')
    expect(playgroundProviderSource).toContain('windowRuntimeWorkspaceAtom')
    expect(playgroundProviderSource).toContain('setRuntimeWorkspace(PLAYGROUND_WORKSPACE)')
    expect(playgroundProviderSource).toContain('windowWorkspacesAtom')
    expect(playgroundProviderSource).toContain('setWindowWorkspaces([PLAYGROUND_WORKSPACE])')
  })
})
