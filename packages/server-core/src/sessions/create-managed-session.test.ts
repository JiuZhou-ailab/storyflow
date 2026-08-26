// input: Persisted session fields, runtime roots, and Free/Project workspace identities
// output: Regression coverage for restored state, immutable Free cwd, and non-materializing Project observers
// pos: Guards ManagedSession construction and its Project runtime-service boundary

import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FREE_CONVERSATION_WORKSPACE_ID } from '@craft-agent/shared/protocol'
import { getSessionPath } from '@craft-agent/shared/sessions'
import { getSourceGrantRef } from '@craft-agent/shared/sources'
import { createManagedSession, SessionManager } from './SessionManager.ts'
import {
  canAutoEnableSource,
  capPermissionMode,
  filterRestoredSourceSlugs,
  intersectSourceSlugs,
  resolveWorkspaceDefaultPermissionMode,
} from './managed-session.ts'

const source = (slug: string, origin: 'workspace' | 'craft-global') => ({
  origin,
  config: { slug, name: slug, type: 'api', enabled: true },
  definitionIdentity: `${slug}-definition`,
}) as any

describe('createManagedSession', () => {
  const workspace = {
    id: 'ws_test',
    name: 'Test Workspace',
    rootPath: '/tmp/test-workspace',
    createdAt: Date.now(),
  }

  it('does not let delegated work exceed its permission authority', () => {
    expect(capPermissionMode('allow-all', 'ask', 'safe')).toBe('ask')
    expect(capPermissionMode('ask', 'safe', 'safe')).toBe('safe')
    expect(capPermissionMode('allow-all', 'allow-all', 'safe')).toBe('allow-all')
  })

  it('keeps only Host-granted Sources for delegated work', () => {
    expect(intersectSourceSlugs(['allowed', 'blocked'], ['allowed'])).toEqual(['allowed'])
  })

  it('requires a Host grant before Project code can auto-enable a Source', () => {
    const projectSource = source('source-1', 'workspace')
    expect(canAutoEnableSource(workspace as any, [], projectSource)).toBe(false)
    expect(canAutoEnableSource({ ...workspace, defaultEnabledSourceRefs: [getSourceGrantRef(projectSource)] } as any, [], projectSource)).toBe(true)
    expect(canAutoEnableSource(workspace as any, ['source-1'], projectSource)).toBe(true)
    expect(canAutoEnableSource(
      { ...workspace, defaultEnabledSourceRefs: [`craft-global:source-1:${projectSource.definitionIdentity}`] } as any,
      [],
      projectSource,
    )).toBe(false)
  })

  it('does not restore Project-owned Source grants from Project Session files', () => {
    expect(filterRestoredSourceSlugs(
      workspace as any,
      ['project-source', 'global-source'],
      [source('project-source', 'workspace'), source('global-source', 'craft-global')],
    )).toEqual([])
    expect(filterRestoredSourceSlugs(
      { ...workspace, defaultEnabledSourceRefs: [getSourceGrantRef(source('project-source', 'workspace'))] } as any,
      ['project-source', 'global-source'],
      [source('project-source', 'workspace'), source('global-source', 'craft-global')],
    )).toEqual(['project-source'])
  })

  it('fails closed when an old Project has no Host permission grant', () => {
    expect(resolveWorkspaceDefaultPermissionMode(workspace as any, 'allow-all')).toBe('ask')
    expect(resolveWorkspaceDefaultPermissionMode(
      { ...workspace, defaultPermissionMode: 'allow-all' } as any,
      'safe',
    )).toBe('allow-all')
  })

  it('does not recreate a missing Project root while setting up runtime observers', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-missing-project-'))
    const missingRoot = join(parent, 'moved-project')
    const sessionManager = new SessionManager()

    try {
      sessionManager.setupConfigWatcher(missingRoot, 'project-moved')
      expect(existsSync(missingRoot)).toBe(false)
    } finally {
      sessionManager.cleanup()
      rmSync(parent, { recursive: true, force: true })
    }
  })

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

  it('does not restore execute consent from Project-owned Session metadata', () => {
    const managed = createManagedSession({
      id: 'session_untrusted_execute',
      permissionMode: 'allow-all',
    }, workspace as any)

    expect(managed.permissionMode).toBe('ask')
  })

  it('accepts execute mode when the Host explicitly supplies it for the live Session', () => {
    const managed = createManagedSession({
      id: 'session_explicit_execute',
      permissionMode: 'allow-all',
    }, workspace as any, { permissionMode: 'allow-all' })

    expect(managed.permissionMode).toBe('allow-all')
  })

  it('normalizes the legacy managed connection before it reaches runtime state', () => {
    const managed = createManagedSession({
      id: 'session_legacy_gateway',
      llmConnection: 'wangsu-default',
      connectionLocked: true,
    }, workspace as any)

    expect(managed.llmConnection).toBe('storyflow-managed')
    expect(managed.connectionLocked).toBe(true)
  })

  it('consumes legacy runtime ownership into a one-shot Pi migration decision', () => {
    const managed = createManagedSession({
      id: 'session_legacy_runtime',
      legacyAgentRuntime: 'claude-sdk',
      sdkSessionId: 'claude-session',
    }, workspace as any)

    expect((managed as unknown as { agentRuntime?: string }).agentRuntime).toBeUndefined()
    expect(managed.needsPiMigrationSeed).toBe(true)
  })

  it('repairs legacy project sessions without a working directory to the visible workspace root', () => {
    const managed = createManagedSession({
      id: 'session_legacy_project',
    }, workspace as any)

    expect(managed.workingDirectory).toBe(workspace.rootPath)
  })

  it('preserves an explicit project working directory', () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'storyflow-cwd-'))
    const workingDirectory = join(rootPath, '第一卷')
    mkdirSync(workingDirectory)
    try {
      const managed = createManagedSession({
        id: 'session_explicit_project',
        workingDirectory,
      }, { ...workspace, rootPath } as any)

      expect(managed.workingDirectory).toBe(workingDirectory)
    } finally {
      rmSync(rootPath, { recursive: true, force: true })
    }
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

  it('keeps the Pi run cwd immutable after the conversation has started', () => {
    const sessionManager = new SessionManager()
    const initialWorkingDirectory = '/tmp/test-workspace'
    const managed = createManagedSession({
      id: 'session_started',
      workingDirectory: initialWorkingDirectory,
      sdkCwd: initialWorkingDirectory,
    }, workspace as any)
    managed.messages.push({
      id: 'message_1',
      role: 'user',
      content: 'Create ./result.md',
      timestamp: Date.now(),
    })
    ;(sessionManager as unknown as { sessions: Map<string, unknown> })
      .sessions.set(managed.id, managed)

    sessionManager.updateWorkingDirectory(managed.id, '/tmp')

    expect(managed.workingDirectory).toBe(initialWorkingDirectory)
    expect(managed.sdkCwd).toBe(initialWorkingDirectory)
  })

  it('rejects an empty Project conversation cwd outside its Project root', () => {
    const sessionManager = new SessionManager()
    const managed = createManagedSession({
      id: 'session_empty',
      workingDirectory: '/tmp/test-workspace',
      sdkCwd: '/tmp/test-workspace',
    }, workspace as any)
    ;(sessionManager as unknown as { sessions: Map<string, unknown> })
      .sessions.set(managed.id, managed)

    sessionManager.updateWorkingDirectory(managed.id, '/tmp')

    expect(managed.workingDirectory).toBe(workspace.rootPath)
    expect(managed.sdkCwd).toBe(workspace.rootPath)
  })
})
