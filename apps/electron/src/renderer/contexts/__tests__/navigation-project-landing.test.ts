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

  it('preserves explicit session routes while restored project landing routes can still skip auto-select', () => {
    expect(navigationContextSource).toContain('shouldPreserveProjectLandingRoute(params)')
    expect(navigationContextSource).toContain('resolveAutoSelectionRef.current(state, { skipAutoSelect: true })')
    expect(navigationContextSource).toContain("if ('details' in navState && navState.details)")
  })
})
