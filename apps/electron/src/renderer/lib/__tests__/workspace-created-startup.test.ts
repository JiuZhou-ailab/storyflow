// input: renderer app workspace creation flow source
// output: Static regression coverage for new-project writing-workspace landing behavior
// pos: Guards project creation against replacing the writing route with a transient empty conversation

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8')

describe('workspace-created startup route', () => {
  it('lands directly in the writing workspace without creating a transient conversation', () => {
    const createdHandlerSource = appSource.slice(
      appSource.indexOf('const handleProjectHubWorkspaceCreated'),
      appSource.indexOf('// Handle cancel during onboarding')
    )

    expect(createdHandlerSource).toContain('setPendingReadyRoute(routes.view.writing())')
    expect(createdHandlerSource).not.toContain('routes.action.newSession()')
    expect(appSource).not.toContain('openNewProjectConversationAfterSwitchRef')
  })
})
