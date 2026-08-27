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

  it('upgrades a v0.17 Project without trusting a symlinked state root', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-state-init-'))
    const configDir = join(parent, 'host')
    const badRoot = join(parent, 'bad')
    const goodRoot = join(parent, 'good')
    const outsideState = join(parent, 'outside-state')
    mkdirSync(badRoot)
    mkdirSync(outsideState)
    writeFileSync(join(outsideState, 'config.json'), JSON.stringify({
      id: 'directory-bad', name: 'Bad', slug: 'bad', createdAt: 1, updatedAt: 1,
    }))
    symlinkSync(outsideState, join(badRoot, '.craft-agent'), 'dir')
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
        { id: 'project-bad', name: 'Bad', slug: 'bad', rootPath: badRoot, createdAt: 1 },
        { id: 'project-good', name: 'Good', slug: 'good', rootPath: goodRoot, createdAt: 1 },
      ],
      activeWorkspaceId: 'project-bad', activeSessionId: null,
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
          const workspaces = manager.getWorkspaces();
          console.log('STATE_RESULT=' + JSON.stringify({
            bad: workspaces.find(workspace => workspace.id === 'project-bad'),
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
        bad: { rootAvailable: false },
        good: { directoryConfigId: 'directory-good', rootAvailable: true },
        goodIds: ['session-good'],
      })
      expect(result.bad.directoryConfigId).toBeUndefined()
      const stored = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8'))
      expect(stored.workspaces.find((workspace: { id: string }) => workspace.id === 'project-bad').directoryConfigId)
        .toBeUndefined()
      expect(stored.workspaces.find((workspace: { id: string }) => workspace.id === 'project-good').directoryConfigId)
        .toBe('directory-good')
      expect(readFileSync(join(outsideState, 'config.json'), 'utf8')).toContain('directory-bad')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
