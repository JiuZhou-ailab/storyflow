// input: Persisted session fields and Free/Project workspace identities
// output: Regression coverage for restored state and immutable Free Conversation cwd
// pos: Guards ManagedSession construction and its runtime-domain boundary

import { describe, expect, it } from 'bun:test'
import { FREE_CONVERSATION_WORKSPACE_ID } from '@craft-agent/shared/protocol'
import { getSessionPath } from '@craft-agent/shared/sessions'
import { createManagedSession, SessionManager } from './SessionManager.ts'

describe('createManagedSession', () => {
  const workspace = {
    id: 'ws_test',
    name: 'Test Workspace',
    rootPath: '/tmp/test-workspace',
    createdAt: Date.now(),
  }

  it('normalizes legacy thinkingLevel=think on restore', () => {
    const managed = createManagedSession({
      id: 'session_legacy',
      thinkingLevel: 'think' as any,
    }, workspace as any)

    expect(managed.thinkingLevel).toBe('medium')
  })

  it('drops invalid thinking levels instead of leaking them into runtime state', () => {
    const managed = createManagedSession({
      id: 'session_invalid',
      thinkingLevel: 'ultra' as any,
    }, workspace as any)

    expect(managed.thinkingLevel).toBeUndefined()
  })

  it('repairs legacy project sessions without a working directory to the visible workspace root', () => {
    const managed = createManagedSession({
      id: 'session_legacy_project',
    }, workspace as any)

    expect(managed.workingDirectory).toBe(workspace.rootPath)
  })

  it('preserves an explicit project working directory', () => {
    const workingDirectory = '/tmp/test-workspace/第一卷'
    const managed = createManagedSession({
      id: 'session_explicit_project',
      workingDirectory,
    }, workspace as any)

    expect(managed.workingDirectory).toBe(workingDirectory)
  })

  it('keeps legacy Free Conversations inside private session storage', () => {
    const freeWorkspace = {
      ...workspace,
      id: FREE_CONVERSATION_WORKSPACE_ID,
      rootPath: '/tmp/storyflow-free',
    }
    const managed = createManagedSession({
      id: 'session_legacy_free',
    }, freeWorkspace as any)

    expect(managed.workingDirectory).toBe(
      getSessionPath(freeWorkspace.rootPath, managed.id),
    )
  })

  it('rejects working-directory changes for Free Conversations', () => {
    const sessionManager = new SessionManager()
    const privateWorkingDirectory = '/tmp/storyflow-free/session/work'
    const managed = createManagedSession({
      id: 'session_free',
      workingDirectory: privateWorkingDirectory,
      sdkCwd: privateWorkingDirectory,
    }, {
      ...workspace,
      id: FREE_CONVERSATION_WORKSPACE_ID,
      rootPath: '/tmp/storyflow-free',
    } as any)
    ;(sessionManager as unknown as { sessions: Map<string, unknown> })
      .sessions.set(managed.id, managed)

    sessionManager.updateWorkingDirectory(managed.id, '/tmp/a-project')

    expect(managed.workingDirectory).toBe(privateWorkingDirectory)
    expect(managed.sdkCwd).toBe(privateWorkingDirectory)
  })
})
