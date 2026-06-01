// input: MainContentPanel source text and sessions navigator empty-detail behavior
// output: Static regression checks for the project landing empty state entry points
// pos: Guards the no-session-detail content surface without mounting the full app shell

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const mainContentPanelSource = readFileSync(
  new URL('../MainContentPanel.tsx', import.meta.url),
  'utf-8'
)

describe('MainContentPanel project landing empty state', () => {
  it('renders a project landing surface when the sessions navigator has no detail selection', () => {
    expect(mainContentPanelSource).toContain('ProjectLandingEmptyState')
    expect(mainContentPanelSource).toContain('routes.action.newSession()')
    expect(mainContentPanelSource).toContain("routes.view.settings('workspace')")
    expect(mainContentPanelSource).toContain('projectLanding.title')
  })
})
