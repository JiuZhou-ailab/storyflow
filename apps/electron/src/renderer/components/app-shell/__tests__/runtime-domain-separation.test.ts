// input: Renderer navigation, transfer UI, main-process orchestration, and ChatPage source
// output: Static regression coverage for Free/Project ownership boundaries
// pos: Guards against routing Free Conversations back into project history or bundle transfer

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const appSource = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8')
const chatPageSource = readFileSync(new URL('../../../pages/ChatPage.tsx', import.meta.url), 'utf8')
const transferDialogSource = readFileSync(new URL('../SendToWorkspaceDialog.tsx', import.meta.url), 'utf8')
const mainSource = readFileSync(new URL('../../../../main/index.ts', import.meta.url), 'utf8')
const sessionManagerSource = readFileSync(
  new URL('../../../../../../../packages/server-core/src/sessions/SessionManager.ts', import.meta.url),
  'utf8',
)

describe('runtime domain separation', () => {
  it('switches rooms through one runtime workspace activation path', () => {
    expect(appSource).toContain('activateRuntimeWorkspace')

    const freeConversationsStart = appSource.indexOf('const handleOpenFreeConversations')
    const freeConversationsEnd = appSource.indexOf('\n  useEffect(() => {', freeConversationsStart)
    const freeConversationsSource = appSource.slice(freeConversationsStart, freeConversationsEnd)
    expect(freeConversationsSource).toContain(
      'const targetRoute = options?.createNew ? routes.action.newSession() : routes.view.allSessions()',
    )
    expect(freeConversationsSource).toContain(
      'return activateRuntimeWorkspace(FREE_CONVERSATION_WORKSPACE_ID, targetRoute)',
    )

    const projectSessionStart = appSource.indexOf('const handleSelectProjectSession')
    const projectSessionEnd = appSource.indexOf('\n\n  // Handle workspace switch', projectSessionStart)
    const projectSessionSource = appSource.slice(projectSessionStart, projectSessionEnd)
    expect(projectSessionSource).toContain(
      'await activateRuntimeWorkspace(workspaceId, routes.view.allSessions(sessionId))',
    )
  })

  it('does not expose a project-directory picker in Free Conversations', () => {
    expect(chatPageSource).toContain('activeWorkspaceId !== FREE_CONVERSATION_WORKSPACE_ID')
    expect(chatPageSource).toContain('canChangeWorkingDirectory ? handleWorkingDirectoryChange : undefined')
  })

  it('creates cross-domain sessions from summaries instead of copying session bundles', () => {
    const transferHandlerStart = mainSource.indexOf("ipcMain.handle('session:transferToRemoteWorkspace'")
    const transferHandlerEnd = mainSource.indexOf('// App relaunch', transferHandlerStart)
    const transferHandler = mainSource.slice(transferHandlerStart, transferHandlerEnd)

    expect(transferHandlerStart).toBeGreaterThan(-1)
    expect(transferHandler).toContain('exportRemoteSessionTransfer')
    expect(transferHandler).toContain('importRemoteSessionTransfer')
    expect(transferHandler).not.toContain("invoke('sessions:export',")
    expect(transferHandler).not.toContain("invoke('sessions:import',")
    expect(transferHandler).not.toContain('SessionBundle')
    expect(transferDialogSource).toContain('FREE_CONVERSATION_WORKSPACE_ID')
    expect(transferDialogSource).toContain('fresh summary-seeded session')
  })

  it('starts the target session with target-domain operational defaults', () => {
    const importStart = sessionManagerSource.indexOf('async importRemoteSessionTransfer(')
    const importEnd = sessionManagerSource.indexOf('/**', importStart)
    const importSource = sessionManagerSource.slice(importStart, importEnd)

    expect(importStart).toBeGreaterThan(-1)
    expect(importSource).toContain('this.createSession(workspaceId)')
    expect(importSource).not.toContain('payload.permissionMode')
    expect(importSource).not.toContain('payload.sessionStatus')
    expect(importSource).not.toContain('payload.labels')
  })
})
