// input: NavigationContext source text and project landing route expectations
// output: Static regression checks for default landing auto-select suppression
// pos: Guards initial project entry routing without mounting the provider

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const navigationContextSource = readFileSync(
  new URL('../NavigationContext.tsx', import.meta.url),
  'utf-8'
)

describe('project landing navigation', () => {
  it('does not auto-select a recent session for the initial default allSessions route', () => {
    expect(navigationContextSource).toContain('navigate(routes.view.allSessions(), { skipAutoSelect: true })')
  })

  it('preserves explicit session routes while only the project landing skips auto-select', () => {
    expect(navigationContextSource).toContain('shouldPreserveProjectLandingRoute(params)')
    expect(navigationContextSource).toContain('resolveAutoSelectionRef.current(state, { skipAutoSelect: true })')
    expect(navigationContextSource).toContain("if ('details' in navState && navState.details)")
  })
})
