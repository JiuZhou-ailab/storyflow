// input: Legacy and unsafe Project registrations plus healthy Session history
// output: Safe identity upgrade and per-Project failure without cross-Project history loss
// pos: Regression coverage for sharded Session discovery health

import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const SESSION_MANAGER_MODULE_PATH = pathToFileURL(join(import.meta.dir, 'SessionManager.ts')).href
const SERVER_BOOTSTRAP_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'bootstrap', 'headless-start.ts')).href

function writeProjectConfig(rootPath: string, id: string): void {
  mkdirSync(join(rootPath, '.craft-agent'), { recursive: true })
  writeFileSync(join(rootPath, '.craft-agent', 'config.json'), JSON.stringify({
    id, name: id, slug: id, createdAt: 1, updatedAt: 1,
  }))
}

describe('Project Session initialization isolation', () => {
  it('keeps a healthy Project available when another Session store is unsafe', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-session-init-'))
    const configDir = join(parent, 'host')
    const badRoot = join(parent, 'bad')
    const goodRoot = join(parent, 'good')
    const outsideSessions = join(parent, 'outside-sessions')
    writeProjectConfig(badRoot, 'directory-bad')
    writeProjectConfig(goodRoot, 'directory-good')
    mkdirSync(outsideSessions)
    symlinkSync(outsideSessions, join(badRoot, '.craft-agent', 'sessions'), 'dir')
    const goodSessionDir = join(goodRoot, '.craft-agent', 'sessions', 'session-good')
    mkdirSync(goodSessionDir, { recursive: true })
    writeFileSync(join(goodSessionDir, 'session.jsonl'), `${JSON.stringify({
      id: 'session-good', createdAt: 1, lastUsedAt: 1, messageCount: 0,
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
    })}\n`)
    mkdirSync(configDir)
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [
        { id: 'project-bad', name: 'Bad', slug: 'bad', rootPath: badRoot, createdAt: 1, directoryConfigId: 'directory-bad' },
        { id: 'project-good', name: 'Good', slug: 'good', rootPath: goodRoot, createdAt: 1, directoryConfigId: 'directory-good' },
      ],
      activeWorkspaceId: 'project-bad', activeSessionId: null,
    }))

    try {
      const run = Bun.spawnSync([
        process.execPath,
        '--eval',
        `
          import { SessionManager } from '${SESSION_MANAGER_MODULE_PATH}';
          const manager = new SessionManager();
          await manager.persistence.loadSessionsFromDisk();
          let badError;
          try { await manager.waitForInit('project-bad'); } catch (error) { badError = error.message; }
          await manager.waitForInit('project-good');
          console.log('INIT_RESULT=' + JSON.stringify({
            badError,
            goodIds: manager.getSessions('project-good').map(session => session.id),
          }));
          manager.cleanup();
        `,
      ], {
        env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      if (run.exitCode !== 0) throw new Error(run.stderr.toString())
      const match = run.stdout.toString().match(/INIT_RESULT=(\{.*\})/)
      if (!match) throw new Error(`Missing init result:\n${run.stdout.toString()}`)
      const result = JSON.parse(match[1])
      expect(result.badError).toContain('symbolic link')
      expect(result.goodIds).toEqual(['session-good'])
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('upgrades v0.17 Project identities without coupling healthy Projects to unsafe state or Sessions', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-state-init-'))
    const configDir = join(parent, 'host')
    const stateBadRoot = join(parent, 'state-bad')
    const sessionBadRoot = join(parent, 'session-bad')
    const goodRoot = join(parent, 'good')
    const outsideState = join(parent, 'outside-state')
    const outsideSessions = join(parent, 'outside-sessions')
    mkdirSync(stateBadRoot)
    mkdirSync(outsideState)
    writeFileSync(join(outsideState, 'config.json'), JSON.stringify({
      id: 'directory-state-bad', name: 'State Bad', slug: 'state-bad', createdAt: 1, updatedAt: 1,
    }))
    symlinkSync(outsideState, join(stateBadRoot, '.craft-agent'), 'dir')
    writeProjectConfig(sessionBadRoot, 'directory-session-bad')
    mkdirSync(outsideSessions)
    writeFileSync(join(outsideSessions, 'keep.txt'), 'keep')
    symlinkSync(outsideSessions, join(sessionBadRoot, '.craft-agent', 'sessions'), 'dir')
    writeProjectConfig(goodRoot, 'directory-good')
    const goodSessionDir = join(goodRoot, '.craft-agent', 'sessions', 'session-good')
    mkdirSync(goodSessionDir, { recursive: true })
    writeFileSync(join(goodSessionDir, 'session.jsonl'), `${JSON.stringify({
      id: 'session-good', createdAt: 1, lastUsedAt: 1, messageCount: 0,
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
    })}\n`)
    mkdirSync(configDir)
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [
        { id: 'project-state-bad', name: 'State Bad', slug: 'state-bad', rootPath: stateBadRoot, createdAt: 1 },
        { id: 'project-session-bad', name: 'Session Bad', slug: 'session-bad', rootPath: sessionBadRoot, createdAt: 1 },
        { id: 'project-good', name: 'Good', slug: 'good', rootPath: goodRoot, createdAt: 1 },
      ],
      activeWorkspaceId: 'project-session-bad', activeSessionId: null,
    }))

    try {
      const run = Bun.spawnSync([
        process.execPath,
        '--eval',
        `
          import { randomBytes } from 'node:crypto';
          import { bootstrapServer } from '${SERVER_BOOTSTRAP_MODULE_PATH}';
          import { SessionManager } from '${SESSION_MANAGER_MODULE_PATH}';
          const manager = new SessionManager();
          manager.reinitializeAuth = async () => {};
          manager.setupConfigWatcher = () => {};
          const instance = await bootstrapServer({
            serverToken: randomBytes(32).toString('hex'),
            rpcHost: '127.0.0.1',
            rpcPort: 0,
            createSessionManager: () => manager,
            createHandlerDeps: () => ({}),
            registerAllRpcHandlers: () => {},
            initializeSessionManager: current => current.initialize(),
            setSessionEventSink: () => {},
            initModelRefreshService: () => ({ startAll() {}, stopAll() {} }),
            cleanupSessionManager: current => current.cleanup(),
          });
          let sessionBadError;
          try { await manager.waitForInit('project-session-bad'); } catch (error) { sessionBadError = error.message; }
          const workspaces = manager.getWorkspaces();
          console.log('STATE_RESULT=' + JSON.stringify({
            stateBad: workspaces.find(workspace => workspace.id === 'project-state-bad'),
            sessionBad: workspaces.find(workspace => workspace.id === 'project-session-bad'),
            sessionBadError,
            good: workspaces.find(workspace => workspace.id === 'project-good'),
            goodIds: manager.getSessions('project-good').map(session => session.id),
          }));
          await instance.stop();
        `,
      ], {
        env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
        stdout: 'pipe', stderr: 'pipe',
      })
      if (run.exitCode !== 0) throw new Error(run.stderr.toString())
      const match = run.stdout.toString().match(/STATE_RESULT=(\{.*\})/)
      if (!match) throw new Error(`Missing state result:\n${run.stdout.toString()}`)
      const result = JSON.parse(match[1])
      expect(result).toMatchObject({
        stateBad: { rootAvailable: false },
        sessionBad: { directoryConfigId: 'directory-session-bad', rootAvailable: true },
        good: { directoryConfigId: 'directory-good', rootAvailable: true },
        goodIds: ['session-good'],
      })
      expect(result.sessionBadError).toContain('symbolic link')
      expect(result.stateBad.directoryConfigId).toBeUndefined()
      const stored = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8'))
      expect(stored.workspaces.find((workspace: { id: string }) => workspace.id === 'project-state-bad').directoryConfigId)
        .toBeUndefined()
      expect(stored.workspaces.find((workspace: { id: string }) => workspace.id === 'project-session-bad').directoryConfigId)
        .toBe('directory-session-bad')
      expect(stored.workspaces.find((workspace: { id: string }) => workspace.id === 'project-good').directoryConfigId)
        .toBe('directory-good')
      expect(readFileSync(join(outsideState, 'config.json'), 'utf8')).toContain('directory-state-bad')
      expect(readFileSync(join(outsideSessions, 'keep.txt'), 'utf8')).toBe('keep')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
