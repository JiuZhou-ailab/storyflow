// input: A registered Project with idle in-memory and durable Sessions
// output: Runtime teardown before Host-only removal, followed by clean re-registration
// pos: Regression coverage for Project removal without deleting user-owned files

import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const SESSION_MANAGER_MODULE_PATH = pathToFileURL(join(import.meta.dir, 'SessionManager.ts')).href

describe('Project removal lifecycle', () => {
  it('serializes Project removal ahead of later Session creation', async () => {
    const managerModule = await import('./SessionManager')
    const manager = new managerModule.SessionManager()
    const events: string[] = []
    let releaseRemoval!: () => void
    const removalBlocked = new Promise<void>(resolve => { releaseRemoval = resolve })
    ;(manager as any).removeWorkspaceLocked = async () => {
      events.push('remove:start')
      await removalBlocked
      events.push('remove:end')
      return true
    }
    ;(manager as any).createSessionLocked = async () => {
      events.push('create')
      return { id: 'session-after-remove' }
    }

    const removal = manager.removeWorkspace('project-serialized')
    await Promise.resolve()
    const creation = manager.createSession('project-serialized')
    await Promise.resolve()
    expect(events).toEqual(['remove:start'])

    releaseRemoval()
    await Promise.all([removal, creation])
    expect(events).toEqual(['remove:start', 'remove:end', 'create'])
    manager.cleanup()
  })

  it('serializes Session deletion behind an in-flight Project relink', async () => {
    const managerModule = await import('./SessionManager')
    const manager = new managerModule.SessionManager()
    const events: string[] = []
    let releaseRelink!: () => void
    const relinkBlocked = new Promise<void>(resolve => { releaseRelink = resolve })
    ;(manager as any).sessions.set('session-serialized', {
      id: 'session-serialized',
      workspace: { id: 'project-serialized' },
    })
    ;(manager as any).rebindWorkspaceRootLocked = async () => {
      events.push('relink:start')
      await relinkBlocked
      events.push('relink:end')
      return { id: 'project-serialized' }
    }
    ;(manager as any).deleteSessionLocked = async () => {
      events.push('delete')
    }

    const relink = manager.rebindWorkspaceRoot('project-serialized', '/target')
    await Promise.resolve()
    const deletion = manager.deleteSession('session-serialized')
    await Promise.resolve()
    expect(events).toEqual(['relink:start'])

    releaseRelink()
    await Promise.all([relink, deletion])
    expect(events).toEqual(['relink:start', 'relink:end', 'delete'])
    ;(manager as any).sessions.clear()
    manager.cleanup()
  })

  it('serializes Host setting updates behind an in-flight Project relink', async () => {
    const managerModule = await import('./SessionManager')
    const manager = new managerModule.SessionManager()
    const events: string[] = []
    let releaseRelink!: () => void
    const relinkBlocked = new Promise<void>(resolve => { releaseRelink = resolve })
    ;(manager as any).rebindWorkspaceRootLocked = async () => {
      events.push('relink:start')
      await relinkBlocked
      events.push('relink:end')
      return { id: 'project-serialized' }
    }
    ;(manager as any).updateProjectHostSettingLocked = async () => {
      events.push('setting')
    }

    const relink = manager.rebindWorkspaceRoot('project-serialized', '/target')
    await Promise.resolve()
    const setting = manager.updateProjectHostSetting('project-serialized', 'automationsEnabled', true)
    await Promise.resolve()
    expect(events).toEqual(['relink:start'])

    releaseRelink()
    await Promise.all([relink, setting])
    expect(events).toEqual(['relink:start', 'relink:end', 'setting'])
    manager.cleanup()
  })

  it('serializes same-root Project registration and activation behind removal', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-register-remove-race-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    mkdirSync(join(projectRoot, '.craft-agent'), { recursive: true })
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(projectRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'directory-id', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
    }))
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-old', name: 'Project', slug: 'project', rootPath: projectRoot,
        createdAt: 1, directoryConfigId: 'directory-id',
      }],
      activeWorkspaceId: 'project-old', activeSessionId: null,
    }))

    try {
      const run = Bun.spawnSync([
        process.execPath,
        '--eval',
        `
          import { SessionManager } from '${SESSION_MANAGER_MODULE_PATH}';
          const manager = new SessionManager();
          const events = [];
          let releaseRemoval;
          const removalBlocked = new Promise(resolve => { releaseRemoval = resolve; });
          manager.removeWorkspaceLocked = async () => {
            events.push('remove:start');
            await removalBlocked;
            events.push('remove:end');
            return true;
          };
          manager.reloadSessions = async () => { events.push('register:reload'); };
          let watcherCalls = 0;
          manager.setupConfigWatcher = () => { events.push('watch:' + ++watcherCalls); };
          const removal = manager.removeWorkspace('project-old');
          await Bun.sleep(0);
          const registration = manager.registerProject('Project', ${JSON.stringify(projectRoot)});
          const activation = manager.activateProject('project-old');
          await Bun.sleep(20);
          const during = [...events];
          releaseRemoval();
          await Promise.all([removal, registration, activation]);
          console.log('REGISTER_REMOVE_RESULT=' + JSON.stringify({ during, after: events }));
          manager.cleanup();
        `,
      ], {
        env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
        stdout: 'pipe', stderr: 'pipe',
      })
      if (run.exitCode !== 0) throw new Error(run.stderr.toString())
      const match = run.stdout.toString().match(/REGISTER_REMOVE_RESULT=(\{.*\})/)
      if (!match) throw new Error(`Missing register/remove result:\n${run.stdout.toString()}`)
      expect(JSON.parse(match[1])).toEqual({
        during: ['remove:start'],
        after: ['remove:start', 'remove:end', 'register:reload', 'watch:1', 'watch:2'],
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('serializes remote reconnect behind Project removal', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-remote-remove-race-'))
    const configDir = join(parent, 'host')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'remote-project', name: 'Remote', slug: 'remote', rootPath: join(parent, 'remote'),
        createdAt: 1,
        remoteServer: {
          url: 'wss://old.example.test',
          credentialRef: 'remote_server_token::remote-project',
          remoteWorkspaceId: 'upstream-project',
        },
      }],
      activeWorkspaceId: 'remote-project', activeSessionId: null,
    }))

    try {
      const run = Bun.spawnSync([
        process.execPath,
        '--eval',
        `
          import { SessionManager } from '${SESSION_MANAGER_MODULE_PATH}';
          const manager = new SessionManager();
          const events = [];
          let releaseRemoval;
          const removalBlocked = new Promise(resolve => { releaseRemoval = resolve; });
          manager.removeWorkspaceLocked = async () => {
            events.push('remove:start');
            await removalBlocked;
            events.push('remove:end');
            return true;
          };
          manager.updateRemoteProjectLocked = async () => { events.push('remote:update'); };
          const removal = manager.removeWorkspace('remote-project');
          await Bun.sleep(0);
          const update = manager.updateRemoteProject('remote-project', {
            url: 'wss://new.example.test', token: 'secret', remoteWorkspaceId: 'upstream-project',
          });
          await Bun.sleep(20);
          const during = [...events];
          releaseRemoval();
          await Promise.all([removal, update]);
          console.log('REMOTE_REMOVE_RESULT=' + JSON.stringify({ during, after: events }));
          manager.cleanup();
        `,
      ], {
        env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
        stdout: 'pipe', stderr: 'pipe',
      })
      if (run.exitCode !== 0) throw new Error(run.stderr.toString())
      const match = run.stdout.toString().match(/REMOTE_REMOVE_RESULT=(\{.*\})/)
      if (!match) throw new Error(`Missing remote/remove result:\n${run.stdout.toString()}`)
      expect(JSON.parse(match[1])).toEqual({
        during: ['remove:start'],
        after: ['remove:start', 'remove:end', 'remote:update'],
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('serializes boot observer startup behind Project removal', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-boot-remove-race-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    mkdirSync(join(projectRoot, '.craft-agent'), { recursive: true })
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(projectRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'directory-id', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
    }))
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-old', name: 'Project', slug: 'project', rootPath: projectRoot,
        createdAt: 1, directoryConfigId: 'directory-id', automationsEnabled: true,
      }],
      activeWorkspaceId: 'project-old', activeSessionId: null,
    }))

    try {
      const run = Bun.spawnSync([
        process.execPath,
        '--eval',
        `
          import { SessionManager } from '${SESSION_MANAGER_MODULE_PATH}';
          const manager = new SessionManager();
          const events = [];
          let releaseDispose;
          const disposeBlocked = new Promise(resolve => { releaseDispose = resolve; });
          manager.configWatchers.set(${JSON.stringify(projectRoot)}, { stop() { events.push('watcher:stop'); } });
          manager.automationSystems.set(${JSON.stringify(projectRoot)}, {
            async dispose() {
              events.push('automation:dispose-start');
              await disposeBlocked;
              events.push('automation:dispose-end');
            },
          });
          manager.reinitializeAuth = async () => {};
          manager.setupConfigWatcher = (rootPath, projectId) => {
            events.push('boot:setup');
            manager.configWatchers.set(rootPath, { stop() {} });
            manager.automationSystems.set(rootPath, { async dispose() {} });
          };
          const removal = manager.removeWorkspace('project-old');
          while (!events.includes('automation:dispose-start')) await Bun.sleep(0);
          const boot = manager.persistence.deps.prepareBootServices();
          await Bun.sleep(20);
          const during = [...events];
          releaseDispose();
          const removed = await removal;
          await boot;
          console.log('BOOT_REMOVE_RESULT=' + JSON.stringify({
            removed,
            during,
            after: events,
            watchers: manager.configWatchers.size,
            automations: manager.automationSystems.size,
            hostCount: manager.getWorkspaces().length,
          }));
          manager.cleanup();
        `,
      ], {
        env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
        stdout: 'pipe', stderr: 'pipe',
      })
      if (run.exitCode !== 0) throw new Error(run.stderr.toString())
      const match = run.stdout.toString().match(/BOOT_REMOVE_RESULT=(\{.*\})/)
      if (!match) throw new Error(`Missing boot/remove result:\n${run.stdout.toString()}`)
      expect(JSON.parse(match[1])).toEqual({
        removed: true,
        during: ['watcher:stop', 'automation:dispose-start'],
        after: ['watcher:stop', 'automation:dispose-start', 'automation:dispose-end'],
        watchers: 0,
        automations: 0,
        hostCount: 0,
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('clears runtime ownership without deleting the Project directory', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-remove-project-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    const sessionDir = join(projectRoot, '.craft-agent', 'sessions', 'session-1')
    mkdirSync(sessionDir, { recursive: true })
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(projectRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'directory-id', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
    }))
    writeFileSync(join(sessionDir, 'session.jsonl'), `${JSON.stringify({
      id: 'session-1', createdAt: 1, lastUsedAt: 1, messageCount: 0,
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
    })}\n`)
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-old', name: 'Project', slug: 'project', rootPath: projectRoot,
        createdAt: 1, directoryConfigId: 'directory-id',
      }],
      activeWorkspaceId: 'project-old', activeSessionId: null,
    }))

    try {
      const run = Bun.spawnSync([
        process.execPath,
        '--eval',
        `
          import { SessionManager, createManagedSession } from '${SESSION_MANAGER_MODULE_PATH}';
          import { registerLocalProject } from '@craft-agent/shared/workspaces';
          const manager = new SessionManager();
          const workspace = manager.getWorkspaces()[0];
          const managed = createManagedSession({ id: 'session-1' }, workspace, { messagesLoaded: true });
          manager.sessions.set(managed.id, managed);
          const removed = await manager.removeWorkspace('project-old');
          const runtimeCountAfterRemove = manager.getSessions('project-old').length;
          const readded = registerLocalProject('Project', ${JSON.stringify(projectRoot)});
          await manager.reloadSessions(readded.id);
          console.log('REMOVE_RESULT=' + JSON.stringify({
            removed,
            runtimeCountAfterRemove,
            readdedId: readded.id,
            reloadedCount: manager.getSessions(readded.id).length,
          }));
          manager.cleanup();
        `,
      ], {
        env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      if (run.exitCode !== 0) {
        throw new Error(`${run.stderr.toString()}\n${run.stdout.toString()}`)
      }
      const match = run.stdout.toString().match(/REMOVE_RESULT=(\{.*\})/)
      if (!match) throw new Error(`Missing remove result:\n${run.stdout.toString()}`)
      expect(JSON.parse(match[1])).toMatchObject({
        removed: true,
        runtimeCountAfterRemove: 0,
        reloadedCount: 1,
      })
      expect(JSON.parse(match[1]).readdedId).not.toBe('project-old')
      expect(existsSync(projectRoot)).toBe(true)
      expect(existsSync(join(sessionDir, 'session.jsonl'))).toBe(true)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('removes a recovered Project without losing loaded or cold transcripts', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-remove-project-recovered-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    const offlineRoot = join(parent, 'project-offline')
    const loadedSessionDir = join(projectRoot, '.craft-agent', 'sessions', 'session-loaded')
    const coldSessionDir = join(projectRoot, '.craft-agent', 'sessions', 'session-cold')
    const openedSessionDir = join(projectRoot, '.craft-agent', 'sessions', 'session-opened')
    mkdirSync(loadedSessionDir, { recursive: true })
    mkdirSync(coldSessionDir, { recursive: true })
    mkdirSync(openedSessionDir, { recursive: true })
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(projectRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'directory-id', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
    }))
    for (const [sessionDir, sessionId, messageId] of [
      [loadedSessionDir, 'session-loaded', 'loaded-message'],
      [coldSessionDir, 'session-cold', 'cold-message'],
      [openedSessionDir, 'session-opened', 'opened-message'],
    ] as const) {
      writeFileSync(join(sessionDir, 'session.jsonl'), [
        JSON.stringify({
          id: sessionId, createdAt: 1, lastUsedAt: 1, messageCount: 1,
          tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
        }),
        JSON.stringify({ id: messageId, type: 'user', content: 'disk survives', timestamp: 1 }),
        '',
      ].join('\n'))
    }
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-old', name: 'Project', slug: 'project', rootPath: projectRoot,
        createdAt: 1, directoryConfigId: 'directory-id',
      }],
      activeWorkspaceId: 'project-old', activeSessionId: null,
    }))

    try {
      const run = Bun.spawnSync([
        process.execPath,
        '--eval',
        `
          import { readFileSync, renameSync } from 'node:fs';
          import { join } from 'node:path';
          import { SessionManager, createManagedSession } from '${SESSION_MANAGER_MODULE_PATH}';
          const manager = new SessionManager();
          const workspace = manager.getWorkspaces()[0];
          const loaded = createManagedSession({ id: 'session-loaded' }, workspace, { messagesLoaded: true });
          loaded.messages = [{ id: 'loaded-message', role: 'user', content: 'disk survives', timestamp: 1 }];
          const cold = createManagedSession({ id: 'session-cold' }, workspace, { messagesLoaded: false });
          const opened = createManagedSession({ id: 'session-opened' }, workspace, { messagesLoaded: false });
          manager.sessions.set(loaded.id, loaded);
          manager.sessions.set(cold.id, cold);
          manager.sessions.set(opened.id, opened);
          renameSync(${JSON.stringify(projectRoot)}, ${JSON.stringify(offlineRoot)});
          const errors = {};
          try { await manager.setSessionLabels('session-loaded', ['latest-loaded']); } catch (error) { errors.loaded = error.message; }
          try { await manager.setSessionLabels('session-cold', ['latest-cold']); } catch (error) { errors.cold = error.message; }
          try { await manager.getSession('session-opened'); } catch (error) { errors.opened = error.message; }
          const coldStayedCold = cold.messagesLoaded === false;
          const openedStayedCold = opened.messagesLoaded === false;
          renameSync(${JSON.stringify(offlineRoot)}, ${JSON.stringify(projectRoot)});
          const removed = await manager.removeWorkspace('project-old');
          const readSession = path => readFileSync(path, 'utf8').trim().split('\\n').map(line => JSON.parse(line));
          const loadedLines = readSession(join(${JSON.stringify(loadedSessionDir)}, 'session.jsonl'));
          const coldLines = readSession(join(${JSON.stringify(coldSessionDir)}, 'session.jsonl'));
          const openedLines = readSession(join(${JSON.stringify(openedSessionDir)}, 'session.jsonl'));
          console.log('RECOVERED_REMOVE_RESULT=' + JSON.stringify({
            removed,
            errors,
            coldStayedCold,
            openedStayedCold,
            loaded: { labels: loadedLines[0].labels, messageIds: loadedLines.slice(1).map(line => line.id) },
            cold: { labels: coldLines[0].labels, messageIds: coldLines.slice(1).map(line => line.id) },
            opened: { messageIds: openedLines.slice(1).map(line => line.id) },
          }));
          manager.cleanup();
        `,
      ], {
        env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
        stdout: 'pipe', stderr: 'pipe',
      })
      if (run.exitCode !== 0) throw new Error(run.stderr.toString())
      const match = run.stdout.toString().match(/RECOVERED_REMOVE_RESULT=(\{.*\})/)
      if (!match) {
        throw new Error(`Missing recovered remove result:\n${run.stderr.toString()}\n${run.stdout.toString()}`)
      }
      expect(JSON.parse(match[1])).toEqual({
        removed: true,
        errors: {
          loaded: expect.stringContaining('Project root does not exist'),
          cold: expect.stringContaining('durable transcript is unavailable'),
          opened: expect.stringContaining('durable transcript is unavailable'),
        },
        coldStayedCold: true,
        openedStayedCold: true,
        loaded: { labels: ['latest-loaded'], messageIds: ['loaded-message'] },
        cold: { labels: ['latest-cold'], messageIds: ['cold-message'] },
        opened: { messageIds: ['opened-message'] },
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('keeps Host and in-memory Sessions when the Host commit fails', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-remove-project-rollback-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    mkdirSync(join(projectRoot, '.craft-agent'), { recursive: true })
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(projectRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'directory-id', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
    }))
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-old', name: 'Project', slug: 'project', rootPath: projectRoot,
        createdAt: 1, directoryConfigId: 'directory-id',
      }],
      activeWorkspaceId: 'project-old', activeSessionId: null,
    }))
    // atomicWriteFileSync uses this exact temporary path; occupying it with a
    // directory gives a deterministic Host pre-commit failure on every OS.
    mkdirSync(join(configDir, 'config.json.tmp'))

    try {
      const run = Bun.spawnSync([
        process.execPath,
        '--eval',
        `
          import { SessionManager, createManagedSession } from '${SESSION_MANAGER_MODULE_PATH}';
          const manager = new SessionManager();
          const workspace = manager.getWorkspaces()[0];
          const managed = createManagedSession({ id: 'session-1' }, workspace, { messagesLoaded: true });
          manager.sessions.set(managed.id, managed);
          let error;
          try { await manager.removeWorkspace('project-old'); } catch (cause) { error = cause.message; }
          console.log('ROLLBACK_RESULT=' + JSON.stringify({
            error,
            runtimeCount: manager.getSessions('project-old').length,
            hostIds: manager.getWorkspaces().map(candidate => candidate.id),
          }));
          manager.cleanup();
        `,
      ], {
        env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
        stdout: 'pipe', stderr: 'pipe',
      })
      if (run.exitCode !== 0) throw new Error(run.stderr.toString())
      const match = run.stdout.toString().match(/ROLLBACK_RESULT=(\{.*\})/)
      if (!match) throw new Error(`Missing rollback result:\n${run.stdout.toString()}`)
      const result = JSON.parse(match[1])
      expect(result.error).toBeTruthy()
      expect(result.runtimeCount).toBe(1)
      expect(result.hostIds).toEqual(['project-old'])
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('keeps the Session in memory when its durable path escapes through a symlink', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-delete-session-symlink-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    const externalRoot = join(parent, 'external-sessions')
    const externalSession = join(externalRoot, 'session-1')
    const sentinel = join(externalSession, 'keep.txt')
    mkdirSync(join(projectRoot, '.craft-agent'), { recursive: true })
    mkdirSync(externalSession, { recursive: true })
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(projectRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'directory-id', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
    }))
    writeFileSync(sentinel, 'keep')
    symlinkSync(
      externalRoot,
      join(projectRoot, '.craft-agent', 'sessions'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-old', name: 'Project', slug: 'project', rootPath: projectRoot,
        createdAt: 1, directoryConfigId: 'directory-id',
      }],
      activeWorkspaceId: 'project-old', activeSessionId: null,
    }))

    try {
      const run = Bun.spawnSync([
        process.execPath,
        '--eval',
        `
          import { SessionManager, createManagedSession } from '${SESSION_MANAGER_MODULE_PATH}';
          const manager = new SessionManager();
          const workspace = manager.getWorkspaces()[0];
          const managed = createManagedSession({ id: 'session-1' }, workspace, { messagesLoaded: true });
          manager.sessions.set(managed.id, managed);
          let error;
          try { await manager.deleteSession('session-1'); } catch (cause) { error = cause.message; }
          console.log('DELETE_SYMLINK_RESULT=' + JSON.stringify({
            error,
            retainedInMemory: manager.sessions.has('session-1'),
            runtimeState: manager.sessions.get('session-1')?.runtimeState ?? null,
          }));
          manager.cleanup();
        `,
      ], {
        env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
        stdout: 'pipe', stderr: 'pipe',
      })
      if (run.exitCode !== 0) throw new Error(run.stderr.toString())
      const match = run.stdout.toString().match(/DELETE_SYMLINK_RESULT=(\{.*\})/)
      if (!match) throw new Error(`Missing delete symlink result:\n${run.stdout.toString()}`)
      expect(JSON.parse(match[1])).toMatchObject({
        error: expect.stringContaining('Project-owned storage'),
        retainedInMemory: true,
        runtimeState: null,
      })
      expect(existsSync(sentinel)).toBe(true)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
