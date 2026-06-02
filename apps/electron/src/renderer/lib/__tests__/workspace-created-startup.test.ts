// input: renderer app workspace creation flow source
// output: Static regression coverage for new-project startup conversation behavior
// pos: Guards project creation against landing on project overview instead of a default chat

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8')

describe('workspace-created startup conversation', () => {
  it('opens a default conversation after creating a project from ProjectHub', () => {
    expect(appSource).toContain('openNewProjectConversationAfterSwitchRef')
    expect(appSource).toContain('navigate(routes.action.newSession())')
    expect(appSource).not.toContain('Newly-created workspaces land on the project overview')
  })
})
