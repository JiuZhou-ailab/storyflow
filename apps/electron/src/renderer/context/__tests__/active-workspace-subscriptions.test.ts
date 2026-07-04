// input: Active workspace hook and window workspace atom wiring
// output: Regression coverage for active workspace subscription boundaries
// pos: Keeps workspace-root consumers off broad app shell context updates

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const contextSource = readFileSync(new URL('../AppShellContext.tsx', import.meta.url), 'utf-8')
const atomsSource = readFileSync(new URL('../../atoms/sessions.ts', import.meta.url), 'utf-8')
const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf-8')
const playgroundProviderSource = readFileSync(new URL('../../playground/PlaygroundAppShellProvider.tsx', import.meta.url), 'utf-8')

describe('active workspace subscriptions', () => {
  it('resolves active workspace from window workspace atoms instead of app shell context', () => {
    expect(atomsSource).toContain('windowWorkspacesAtom')
    expect(contextSource).toContain('windowWorkspacesAtom')
    expect(contextSource).toContain('windowWorkspaceIdAtom')

    const hookSource = contextSource.slice(
      contextSource.indexOf('export function useActiveWorkspace'),
      contextSource.indexOf('/**', contextSource.indexOf('export function useActiveWorkspace') + 1),
    )

    expect(hookSource).toContain('useAtomValue(windowWorkspacesAtom)')
    expect(hookSource).toContain('useAtomValue(windowWorkspaceIdAtom)')
    expect(hookSource).not.toContain('useAppShellContext')
  })

  it('keeps the real app and playground provider in sync with the workspace atoms', () => {
    expect(appSource).toContain('useAtom(windowWorkspacesAtom)')
    expect(playgroundProviderSource).toContain('windowWorkspacesAtom')
    expect(playgroundProviderSource).toContain('setWindowWorkspaces([PLAYGROUND_WORKSPACE])')
  })
})
