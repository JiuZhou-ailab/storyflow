// input: Persisted session fields and Free/Project workspace identities
// output: Regression coverage for restored state and immutable Free Conversation cwd
// pos: Guards ManagedSession construction and its runtime-domain boundary

import { describe, expect, it } from 'bun:test'
import { FREE_CONVERSATION_WORKSPACE_ID } from '@craft-agent/shared/protocol'
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
