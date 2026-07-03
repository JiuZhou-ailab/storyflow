// input: NavigationContext source text and default project route expectations
// output: Static regression checks for default route session auto-selection
// pos: Guards project entry routing without mounting the provider

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const navigationContextSource = readFileSync(
  new URL('../NavigationContext.tsx', import.meta.url),
  'utf-8'
)

describe('project default navigation', () => {
  it('auto-selects a recent session for the initial default allSessions route', () => {
    expect(navigationContextSource).toContain('navigate(routes.view.allSessions())')
    expect(navigationContextSource).not.toContain('navigate(routes.view.allSessions(), { skipAutoSelect: true })')
  })

  it('lets restored project landing routes skip auto-select without bypassing route validation', () => {
    expect(navigationContextSource).toContain('shouldPreserveProjectLandingRoute(params)')
    expect(navigationContextSource).toContain('resolveAutoSelectionRef.current(state, { skipAutoSelect: true })')
    expect(navigationContextSource).toContain('normalizePanelRouteForReconcile(')
    expect(navigationContextSource).not.toContain("if ('details' in navState && navState.details)")
  })

  it('memoizes the provider value so unrelated provider renders do not notify consumers', () => {
    expect(navigationContextSource).toContain('const contextValue = useMemo<NavigationContextValue>(() => ({')
    expect(navigationContextSource).toContain('<NavigationContext.Provider value={contextValue}>')
    expect(navigationContextSource).not.toContain('<NavigationContext.Provider\n      value={{')
  })
})
