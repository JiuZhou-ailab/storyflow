// input: Legacy and unsafe Project registrations plus healthy Session history
// output: Safe identity upgrade and per-Project failure without cross-Project history loss
// pos: Regression coverage for sharded Session discovery health

import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
  it('keeps Session history indexed while an authorized external cwd is offline', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-session-offline-cwd-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    const missingCwd = join(parent, 'offline-cwd')
    writeProjectConfig(projectRoot, 'directory-project')
    const canonicalProjectRoot = realpathSync(projectRoot)
    const canonicalMissingCwd = join(realpathSync(parent), 'offline-cwd')
    for (const [id, workingDirectory] of [
      ['session-good', undefined],
      ['session-offline', missingCwd],
    ] as const) {
      const sessionDir = join(projectRoot, '.craft-agent', 'sessions', id)
      mkdirSync(sessionDir, { recursive: true })
      writeFileSync(join(sessionDir, 'session.jsonl'), `${JSON.stringify({
        id, createdAt: 1, lastUsedAt: 1, messageCount: 0, workingDirectory,
        workspaceRootPath: projectRoot,
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
      })}\n`)
    }
    mkdirSync(configDir)
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-id', name: 'Project', slug: 'project', rootPath: canonicalProjectRoot,
        createdAt: 1, directoryConfigId: 'directory-project',
        grantedWorkingDirectoryRoots: [canonicalMissingCwd],
      }],
      activeWorkspaceId: 'project-id', activeSessionId: null,
    }))

    try {
      const run = Bun.spawnSync([
        process.execPath,
        '--eval',
        `
          import { listSessions } from '@craft-agent/shared/sessions';
          import { SessionManager } from '${SESSION_MANAGER_MODULE_PATH}';
          const storedIds = listSessions(${JSON.stringify(projectRoot)}).map(session => session.id).sort();
          const manager = new SessionManager();
          await manager.persistence.loadSessionsFromDisk();
          let initError;
          try { await manager.waitForInit('project-id'); } catch (error) { initError = error.message; }
          console.log('OFFLINE_CWD_RESULT=' + JSON.stringify({
            initError,
            storedIds,
            sessions: manager.getSessions('project-id')
              .map(session => ({ id: session.id, workingDirectory: session.workingDirectory }))
              .sort((left, right) => left.id.localeCompare(right.id)),
          }));
          manager.cleanup();
        `,
      ], {
        env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      if (run.exitCode !== 0) throw new Error(run.stderr.toString())
      const match = run.stdout.toString().match(/OFFLINE_CWD_RESULT=(\{.*\})/)
      if (!match) throw new Error(`Missing offline cwd result:\n${run.stdout.toString()}`)
      expect(JSON.parse(match[1])).toEqual({
        storedIds: ['session-good', 'session-offline'],
        sessions: [
          { id: 'session-good', workingDirectory: canonicalProjectRoot },
          { id: 'session-offline', workingDirectory: canonicalMissingCwd },
        ],
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('keeps a healthy Project available when another Session store is unsafe', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-session-init-'))
    const configDir = join(parent, 'host')
    const badRoot = join(parent, 'bad')
    const goodRoot = join(parent, 'good')
    const outsideSessions = join(parent, 'outside-sessions')
    writeProjectConfig(badRoot, 'directory-bad')
    writeProjectConfig(goodRoot, 'directory-good')
    const canonicalBadRoot = realpathSync(badRoot)
    const canonicalGoodRoot = realpathSync(goodRoot)
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
        { id: 'project-bad', name: 'Bad', slug: 'bad', rootPath: canonicalBadRoot, createdAt: 1, directoryConfigId: 'directory-bad' },
        { id: 'project-good', name: 'Good', slug: 'good', rootPath: canonicalGoodRoot, createdAt: 1, directoryConfigId: 'directory-good' },
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
    const rootConfigOnlyRoot = join(parent, 'root-config-only')
    const goodRoot = join(parent, 'good')
    const externalCwd = join(parent, 'external-cwd')
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
    mkdirSync(rootConfigOnlyRoot)
    writeFileSync(join(rootConfigOnlyRoot, 'config.json'), JSON.stringify({
      id: 'directory-root-only', name: 'Root Only', slug: 'root-only', createdAt: 1, updatedAt: 1,
    }))
    writeProjectConfig(goodRoot, 'directory-good')
    mkdirSync(externalCwd)
    const canonicalExternalCwd = realpathSync(externalCwd)
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
        { id: 'project-root-only', name: 'Root Only', slug: 'root-only', rootPath: rootConfigOnlyRoot, createdAt: 1 },
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
          import { grantWorkspaceWorkingDirectory } from '@craft-agent/shared/workspaces';
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
          await manager.waitForInit('project-good');
          const goodIds = manager.getSessions('project-good').map(session => session.id);
          let ungrantedCwdError;
          try {
            await manager.createSession('project-good', { workingDirectory: ${JSON.stringify(externalCwd)} });
          } catch (error) {
            ungrantedCwdError = error.message;
          }
          grantWorkspaceWorkingDirectory('project-good', ${JSON.stringify(externalCwd)});
          const externalCwdSession = await manager.createSession('project-good', {
            workingDirectory: ${JSON.stringify(externalCwd)},
          });
          const workspaces = manager.getWorkspaces();
          console.log('STATE_RESULT=' + JSON.stringify({
            stateBad: workspaces.find(workspace => workspace.id === 'project-state-bad'),
            sessionBad: workspaces.find(workspace => workspace.id === 'project-session-bad'),
            rootOnly: workspaces.find(workspace => workspace.id === 'project-root-only'),
            sessionBadError,
            good: workspaces.find(workspace => workspace.id === 'project-good'),
            goodIds,
            ungrantedCwdError,
            externalCwd: externalCwdSession.workingDirectory,
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
        sessionBad: { directoryConfigId: 'directory-session-bad' },
        good: { directoryConfigId: 'directory-good' },
        goodIds: ['session-good'],
        ungrantedCwdError: 'Working directory is not authorized for this Project. Select the folder again.',
        externalCwd: canonicalExternalCwd,
      })
      expect(result.sessionBadError).toContain('symbolic link')
      expect(result.stateBad.directoryConfigId).toBeUndefined()
      const stored = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8'))
      expect(stored.workspaces.find((workspace: { id: string }) => workspace.id === 'project-state-bad').directoryConfigId)
        .toBeUndefined()
      expect(stored.workspaces.find((workspace: { id: string }) => workspace.id === 'project-session-bad').directoryConfigId)
        .toBe('directory-session-bad')
      expect(stored.workspaces.find((workspace: { id: string }) => workspace.id === 'project-root-only').directoryConfigId)
        .toBeUndefined()
      expect(stored.workspaces.find((workspace: { id: string }) => workspace.id === 'project-good').directoryConfigId)
        .toBe('directory-good')
      expect(stored.migrationsApplied).toBeUndefined()
      expect(stored.workspaces.find((workspace: { id: string }) => workspace.id === 'project-good').grantedWorkingDirectoryRoots)
        .toEqual([canonicalExternalCwd])
      expect(readFileSync(join(outsideState, 'config.json'), 'utf8')).toContain('directory-state-bad')
      expect(readFileSync(join(outsideSessions, 'keep.txt'), 'utf8')).toBe('keep')
      expect(existsSync(join(rootConfigOnlyRoot, '.craft-agent'))).toBeFalse()
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
