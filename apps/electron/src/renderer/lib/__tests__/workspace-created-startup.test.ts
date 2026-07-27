// input: renderer app workspace creation flow source
// output: Static regression coverage for new-project starter-conversation landing behavior
// pos: Guards project creation so it opens a project-owned initial conversation

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8')

describe('workspace-created startup route', () => {
  it('creates and opens the project starter conversation', () => {
    const createdHandlerSource = appSource.slice(
      appSource.indexOf('const handleProjectHubWorkspaceCreated'),
      appSource.indexOf('// Handle cancel during onboarding')
    )

    expect(createdHandlerSource).toContain('await handleSelectWorkspace(workspace.id)')
    expect(createdHandlerSource).toContain('const session = await handleCreateSession(workspace.id)')
    expect(createdHandlerSource).toContain('await handleSelectProjectSession(workspace.id, session.id)')
    expect(createdHandlerSource).not.toContain('routes.action.newSession()')
    expect(appSource).not.toContain('openNewProjectConversationAfterSwitchRef')
  })
})
