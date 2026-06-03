// input: MainContentPanel source text and sessions navigator empty-detail behavior
// output: Static regression checks for the normal empty chat startup contract
// pos: Guards against replacing the default conversation surface with project overview chrome

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const mainContentPanelSource = readFileSync(
  new URL('../MainContentPanel.tsx', import.meta.url),
  'utf-8'
)

describe('MainContentPanel sessions empty state', () => {
  it('keeps the sessions empty-detail surface as the normal conversation prompt', () => {
    expect(mainContentPanelSource).not.toContain('ProjectLandingEmptyState')
    expect(mainContentPanelSource).not.toContain('projectLanding.title')
    expect(mainContentPanelSource).toContain('session.selectConversation')
  })
})
