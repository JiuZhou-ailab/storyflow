// input: AppShell source and workspace unread indicator wiring
// output: Regression coverage for deleting unconsumed AppShell state writes
// pos: Keeps large-workspace shell updates from maintaining unused unread maps

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const appShellSource = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8')

describe('AppShell unused state', () => {
  it('does not maintain workspace unread maps without a rendered consumer', () => {
    expect(appShellSource).not.toContain('setWorkspaceUnreadMap')
    expect(appShellSource).not.toContain('getUnreadSummary')
    expect(appShellSource).not.toContain('onUnreadSummaryChanged')
  })
})
