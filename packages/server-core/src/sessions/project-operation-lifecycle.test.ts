// input: A registered Project, one accepted long-running Project operation, and a concurrent lifecycle transition
// output: Regression coverage for lock-free Project work plus transition-owned operation draining
// pos: Guards shared and exclusive Project operation linearization around lifecycle transitions

import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runIsolatedJson } from './isolated-test-runner'

const SESSION_MANAGER_PATH = pathToFileURL(join(import.meta.dir, 'SessionManager.ts')).href

describe('Project operation lifecycle', () => {
  it('runs accepted work outside the lifecycle lock and drains it before removal commit', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-operation-remove-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    mkdirSync(join(projectRoot, '.craft-agent'), { recursive: true })
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(projectRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'directory-id', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
    }))
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-1', name: 'Project', slug: 'project', rootPath: projectRoot,
        createdAt: 1, directoryConfigId: 'directory-id',
      }],
      activeWorkspaceId: 'project-1', activeSessionId: null,
    }))

    try {
      const result = runIsolatedJson(configDir, 'PROJECT_OPERATION_REMOVE', `
          import { SessionManager } from '${SESSION_MANAGER_PATH}';
          const manager = new SessionManager();
          manager.setupConfigWatcher = () => {};
          const events = [];
          let markOperationStarted;
          let finishOperation;
          const operationStarted = new Promise(resolve => { markOperationStarted = resolve; });
          const operationGate = new Promise(resolve => { finishOperation = resolve; });
          manager.removeWorkspaceLocked = async () => {
            events.push('remove:commit');
            return true;
          };

          const operation = manager.withProjectOperation('Project', async workspace => {
            events.push('operation:start:' + workspace.rootPath);
            const reentrant = await Promise.race([
              manager.withProjectLifecycle('project-1', async () => 'ok'),
              Bun.sleep(200).then(() => 'timeout'),
            ]);
            events.push('operation:reentrant:' + reentrant);
            markOperationStarted();
            await operationGate;
            events.push('operation:end');
          });
          await operationStarted;

          const removal = manager.removeWorkspace('project-1');
          let transitionError = null;
          for (let attempt = 0; attempt < 50 && !transitionError; attempt += 1) {
            transitionError = await manager.activateProject('project-1')
              .then(() => null, error => error.message);
            if (!transitionError) await Bun.sleep(0);
          }
          const newOperationError = await manager.withProjectOperation('project-1', async () => {})
            .then(() => null, error => error.message);
          const stateBeforeRelease = await Promise.race([
            removal.then(() => 'removed'),
            Bun.sleep(100).then(() => 'blocked'),
          ]);
          const eventsBeforeRelease = [...events];

          finishOperation();
          await Promise.all([operation, removal]);
          manager.cleanup();
          console.log('PROJECT_OPERATION_REMOVE=' + JSON.stringify({
            transitionError,
            newOperationError,
            stateBeforeRelease,
            eventsBeforeRelease,
            events,
          }));
        `)
      expect(result).toEqual({
        transitionError: expect.stringContaining('removed or relinked'),
        newOperationError: expect.stringContaining('removed or relinked'),
        stateBeforeRelease: 'blocked',
        eventsBeforeRelease: [
          `operation:start:${projectRoot}`,
          'operation:reentrant:ok',
        ],
        events: [
          `operation:start:${projectRoot}`,
          'operation:reentrant:ok',
          'operation:end',
          'remove:commit',
        ],
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('drains accepted work before committing a Project root relink', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-operation-relink-'))
    const configDir = join(parent, 'host')
    const previousRoot = join(parent, 'previous')
    const movedPreviousRoot = join(parent, 'moved-previous')
    const currentRoot = join(parent, 'current')
    mkdirSync(join(previousRoot, '.craft-agent'), { recursive: true })
    mkdirSync(join(currentRoot, '.craft-agent'), { recursive: true })
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(previousRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'directory-id', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
    }))
    writeFileSync(join(currentRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'directory-id', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
    }))
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-1', name: 'Project', slug: 'project', rootPath: previousRoot,
        createdAt: 1, directoryConfigId: 'directory-id',
      }],
      activeWorkspaceId: 'project-1', activeSessionId: null,
    }))

    try {
      const result = runIsolatedJson(configDir, 'PROJECT_OPERATION_RELINK', `
          import { renameSync } from 'node:fs';
          import { SessionManager } from '${SESSION_MANAGER_PATH}';
          const manager = new SessionManager();
          manager.setupConfigWatcher = () => {};
          const events = [];
          let markOperationStarted;
          let finishOperation;
          const operationStarted = new Promise(resolve => { markOperationStarted = resolve; });
          const operationGate = new Promise(resolve => { finishOperation = resolve; });
          manager.rebindWorkspaceRootLocked = async () => {
            events.push('relink:commit');
            return { ...manager.getWorkspaces()[0], rootPath: ${JSON.stringify(currentRoot)} };
          };

          const operation = manager.withProjectOperation('project-1', async workspace => {
            events.push('operation:start:' + workspace.rootPath);
            markOperationStarted();
            await operationGate;
            events.push('operation:end');
          });
          await operationStarted;
          renameSync(${JSON.stringify(previousRoot)}, ${JSON.stringify(movedPreviousRoot)});

          const relink = manager.rebindWorkspaceRoot('project-1', ${JSON.stringify(currentRoot)});
          const stateBeforeRelease = await Promise.race([
            relink.then(() => 'relinked'),
            Bun.sleep(100).then(() => 'blocked'),
          ]);
          const eventsBeforeRelease = [...events];

          finishOperation();
          await Promise.all([operation, relink]);
          manager.cleanup();
          console.log('PROJECT_OPERATION_RELINK=' + JSON.stringify({
            stateBeforeRelease,
            eventsBeforeRelease,
            events,
          }));
        `)
      expect(result).toEqual({
        stateBeforeRelease: 'blocked',
        eventsBeforeRelease: [`operation:start:${previousRoot}`],
        events: [
          `operation:start:${previousRoot}`,
          'operation:end',
          'relink:commit',
        ],
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('blocks new work and drains accepted work before Host automation revocation returns', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-operation-automation-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    mkdirSync(join(projectRoot, '.craft-agent'), { recursive: true })
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(projectRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'directory-id', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
    }))
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-1', name: 'Project', slug: 'project', rootPath: projectRoot,
        createdAt: 1, directoryConfigId: 'directory-id', automationsEnabled: true,
      }],
      activeWorkspaceId: 'project-1', activeSessionId: null,
    }))

    try {
      const result = runIsolatedJson(configDir, 'PROJECT_OPERATION_AUTOMATION', `
          import { SessionManager } from '${SESSION_MANAGER_PATH}';
          const manager = new SessionManager();
          const events = [];
          let markOperationStarted;
          let finishOperation;
          const operationStarted = new Promise(resolve => { markOperationStarted = resolve; });
          const operationGate = new Promise(resolve => { finishOperation = resolve; });
          const operation = manager.withProjectOperation('project-1', async () => {
            events.push('operation:start');
            markOperationStarted();
            await operationGate;
            events.push('operation:end');
          });
          await operationStarted;

          const revoking = manager.updateProjectHostSetting(
            'project-1', 'automationsEnabled', false,
          ).then(() => { events.push('revoke:return'); });
          let newOperationError = null;
          for (let attempt = 0; attempt < 50 && !newOperationError; attempt += 1) {
            newOperationError = await manager.withProjectOperation('project-1', async () => {})
              .then(() => null, error => error.message);
            if (!newOperationError) await Bun.sleep(0);
          }
          const stateBeforeRelease = await Promise.race([
            revoking.then(() => 'revoked'),
            Bun.sleep(100).then(() => 'blocked'),
          ]);
          const eventsBeforeRelease = [...events];

          finishOperation();
          await Promise.all([operation, revoking]);
          const enabled = manager.getWorkspaces()[0].automationsEnabled;
          manager.cleanup();
          console.log('PROJECT_OPERATION_AUTOMATION=' + JSON.stringify({
            newOperationError,
            stateBeforeRelease,
            eventsBeforeRelease,
            events,
            enabled,
          }));
        `)
      expect(result).toEqual({
        newOperationError: expect.stringContaining('removed or relinked'),
        stateBeforeRelease: 'blocked',
        eventsBeforeRelease: ['operation:start'],
        events: ['operation:start', 'operation:end', 'revoke:return'],
        enabled: false,
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('starts exclusive work only after draining accepted work and rejects new operations', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-operation-exclusive-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    mkdirSync(join(projectRoot, '.craft-agent'), { recursive: true })
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(projectRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'directory-id', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
    }))
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-1', name: 'Project', slug: 'project', rootPath: projectRoot,
        createdAt: 1, directoryConfigId: 'directory-id',
      }],
      activeWorkspaceId: 'project-1', activeSessionId: null,
    }))

    try {
      const result = runIsolatedJson(configDir, 'PROJECT_OPERATION_EXCLUSIVE', `
          import { SessionManager } from '${SESSION_MANAGER_PATH}';
          const manager = new SessionManager();
          const events = [];
          let markOperationStarted;
          let finishOperation;
          const operationStarted = new Promise(resolve => { markOperationStarted = resolve; });
          const operationGate = new Promise(resolve => { finishOperation = resolve; });
          const operation = manager.withProjectOperation('project-1', async () => {
            events.push('operation:start');
            markOperationStarted();
            await operationGate;
            events.push('operation:end');
          });
          await operationStarted;

          const { createManagedSession } = await import('${SESSION_MANAGER_PATH}');
          const workspace = manager.getWorkspaces()[0];
          const managed = createManagedSession(
            { id: 'session-1' }, workspace, { messagesLoaded: true },
          );
          manager.sessions.set(managed.id, managed);
          const releaseSessionOperation = manager.beginSessionOperationLease(managed);
          events.unshift('session-operation:start');
          const exclusive = manager.withProjectExclusiveOperation('project-1', async workspace => {
            events.push('exclusive:start:' + workspace.rootPath);
            const nestedOperationError = await manager.withProjectOperation('project-1', async () => {})
              .then(() => null, error => error.message);
            events.push('exclusive:nested:' + nestedOperationError);
          });
          let newOperationError = null;
          for (let attempt = 0; attempt < 50 && !newOperationError; attempt += 1) {
            newOperationError = await manager.withProjectOperation('project-1', async () => {})
              .then(() => null, error => error.message);
            if (!newOperationError) await Bun.sleep(0);
          }
          const stateBeforeRelease = await Promise.race([
            exclusive.then(() => 'completed'),
            Bun.sleep(100).then(() => 'blocked'),
          ]);
          const eventsBeforeRelease = [...events];

          finishOperation();
          await operation;
          const stateAfterProjectRelease = await Promise.race([
            exclusive.then(() => 'completed'),
            Bun.sleep(100).then(() => 'blocked'),
          ]);
          const newSessionOperationError = await Promise.resolve()
            .then(() => manager.beginSessionOperationLease(managed))
            .then(release => { release(); return null; }, error => error.message);
          releaseSessionOperation();
          await exclusive;
          manager.cleanup();
          console.log('PROJECT_OPERATION_EXCLUSIVE=' + JSON.stringify({
            newOperationError,
            newSessionOperationError,
            stateBeforeRelease,
            stateAfterProjectRelease,
            eventsBeforeRelease,
            events,
          }));
        `)
      expect(result).toEqual({
        newOperationError: expect.stringContaining('removed or relinked'),
        newSessionOperationError: expect.stringContaining('closing'),
        stateBeforeRelease: 'blocked',
        stateAfterProjectRelease: 'blocked',
        eventsBeforeRelease: ['session-operation:start', 'operation:start'],
        events: [
          'session-operation:start',
          'operation:start',
          'operation:end',
          `exclusive:start:${projectRoot}`,
          expect.stringContaining('exclusive:nested:Project project-1 is being removed or relinked'),
        ],
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('drains accepted operations before Source and local MCP capability revocations return', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-capability-revoke-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    const sourceDir = join(projectRoot, '.craft-agent', 'sources', 'foo')
    mkdirSync(sourceDir, { recursive: true })
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(projectRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'directory-id', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
    }))
    writeFileSync(join(sourceDir, 'config.json'), JSON.stringify({
      id: 'foo', slug: 'foo', name: 'Foo', provider: 'custom', type: 'mcp', enabled: true,
      mcp: { transport: 'stdio', command: 'true' }, createdAt: 1, updatedAt: 1,
    }))
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-1', name: 'Project', slug: 'project', rootPath: projectRoot,
        createdAt: 1, directoryConfigId: 'directory-id', localMcpEnabled: true,
      }],
      activeWorkspaceId: 'project-1', activeSessionId: null,
    }))

    try {
      const result = runIsolatedJson(configDir, 'PROJECT_CAPABILITY_REVOKE', `
          import { SessionManager } from '${SESSION_MANAGER_PATH}';
          const manager = new SessionManager();

          const probeRevocation = async (key, value) => {
            let markOperationStarted;
            let finishOperation;
            const operationStarted = new Promise(resolve => { markOperationStarted = resolve; });
            const operationGate = new Promise(resolve => { finishOperation = resolve; });
            const operation = manager.withProjectOperation('project-1', async () => {
              markOperationStarted();
              await operationGate;
            });
            await operationStarted;
            const revoking = manager.updateProjectHostSetting('project-1', key, value);
            let newOperationError = null;
            for (let attempt = 0; attempt < 50 && !newOperationError; attempt += 1) {
              newOperationError = await manager.withProjectOperation('project-1', async () => {})
                .then(() => null, error => error.message);
              if (!newOperationError) await Bun.sleep(0);
            }
            const stateBeforeRelease = await Promise.race([
              revoking.then(() => 'revoked'),
              Bun.sleep(100).then(() => 'blocked'),
            ]);
            finishOperation();
            await Promise.all([operation, revoking]);
            return { newOperationError, stateBeforeRelease };
          };

          const localMcp = await probeRevocation('localMcpEnabled', false);
          await manager.updateProjectHostSetting('project-1', 'enabledSourceSlugs', ['foo']);
          const sources = await probeRevocation('enabledSourceSlugs', []);
          const workspace = manager.getWorkspaces()[0];
          manager.cleanup();
          console.log('PROJECT_CAPABILITY_REVOKE=' + JSON.stringify({
            localMcp, sources,
            localMcpEnabled: workspace.localMcpEnabled,
            sourceRefs: workspace.defaultEnabledSourceRefs,
          }));
        `)
      expect(result).toEqual({
        localMcp: {
          newOperationError: expect.stringContaining('removed or relinked'),
          stateBeforeRelease: 'blocked',
        },
        sources: {
          newOperationError: expect.stringContaining('removed or relinked'),
          stateBeforeRelease: 'blocked',
        },
        localMcpEnabled: false,
        sourceRefs: [],
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('enforces the logical transition gate for Free Conversation operations', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-free-operation-exclusive-'))
    const configDir = join(parent, 'host')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [], activeWorkspaceId: null, activeSessionId: null,
    }))

    try {
      const result = runIsolatedJson(configDir, 'FREE_PROJECT_OPERATION_EXCLUSIVE', `
          import { FREE_CONVERSATION_WORKSPACE_ID } from '@craft-agent/shared/protocol';
          import { SessionManager } from '${SESSION_MANAGER_PATH}';
          const manager = new SessionManager();
          const events = [];
          let markExclusiveStarted;
          let finishExclusive;
          const exclusiveStarted = new Promise(resolve => { markExclusiveStarted = resolve; });
          const exclusiveGate = new Promise(resolve => { finishExclusive = resolve; });
          const exclusive = manager.withProjectExclusiveOperation(
            FREE_CONVERSATION_WORKSPACE_ID,
            async () => {
              events.push('exclusive:start');
              markExclusiveStarted();
              await exclusiveGate;
              events.push('exclusive:end');
            },
          );
          await exclusiveStarted;

          const during = await manager.withProjectOperation(
            FREE_CONVERSATION_WORKSPACE_ID,
            async () => {
              events.push('operation:during');
              return 'entered';
            },
          ).then(value => value, error => error.message);
          finishExclusive();
          await exclusive;
          const after = await manager.withProjectOperation(
            FREE_CONVERSATION_WORKSPACE_ID,
            async () => 'accepted',
          );
          manager.cleanup();
          console.log('FREE_PROJECT_OPERATION_EXCLUSIVE=' + JSON.stringify({ during, after, events }));
        `)
      expect(result).toEqual({
        during: expect.stringContaining('removed or relinked'),
        after: 'accepted',
        events: ['exclusive:start', 'exclusive:end'],
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('finishes a remote transfer import before Project removal can commit', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-remote-transfer-lifecycle-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    mkdirSync(join(projectRoot, '.craft-agent'), { recursive: true })
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(projectRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'directory-id', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
    }))
    writeFileSync(join(configDir, 'config-defaults.json'), JSON.stringify({
      workspaceDefaults: {
        permissionMode: 'ask', cyclablePermissionModes: ['safe', 'ask'], localMcpServers: [],
      },
    }))
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-1', name: 'Project', slug: 'project', rootPath: projectRoot,
        createdAt: 1, directoryConfigId: 'directory-id',
      }],
      activeWorkspaceId: 'project-1', activeSessionId: null,
    }))

    try {
      const result = runIsolatedJson(configDir, 'REMOTE_TRANSFER_LIFECYCLE', `
          import { sessionPersistenceQueue } from '@craft-agent/shared/sessions';
          import { SessionManager } from '${SESSION_MANAGER_PATH}';
          const manager = new SessionManager();
          manager.setupConfigWatcher = () => {};
          const events = [];
          manager.removeWorkspaceLocked = async () => {
            events.push('remove:commit');
            return true;
          };

          const originalFlush = sessionPersistenceQueue.flush.bind(sessionPersistenceQueue);
          let markFlushStarted;
          let finishFlush;
          let flushCount = 0;
          const flushStarted = new Promise(resolve => { markFlushStarted = resolve; });
          const flushGate = new Promise(resolve => { finishFlush = resolve; });
          sessionPersistenceQueue.flush = async sessionId => {
            flushCount++;
            if (flushCount === 1) return originalFlush(sessionId);
            events.push('import:flush-start');
            markFlushStarted();
            await flushGate;
            await originalFlush(sessionId);
            events.push('import:flush-end');
          };

          const importing = manager.importRemoteSessionTransfer('project-1', { summary: 'Transferred context' })
            .then(value => { events.push('import:done'); return value; });
          await flushStarted;
          const removal = manager.removeWorkspace('project-1');
          const stateBeforeRelease = await Promise.race([
            removal.then(() => 'removed'),
            Bun.sleep(100).then(() => 'blocked'),
          ]);
          const eventsBeforeRelease = [...events];

          finishFlush();
          const [imported] = await Promise.all([importing, removal]);
          sessionPersistenceQueue.flush = originalFlush;
          manager.cleanup();
          console.log('REMOTE_TRANSFER_LIFECYCLE=' + JSON.stringify({
            stateBeforeRelease,
            eventsBeforeRelease,
            events,
            imported: !!imported.sessionId,
          }));
        `)
      expect(result).toEqual({
        stateBeforeRelease: 'blocked',
        eventsBeforeRelease: ['import:flush-start'],
        events: ['import:flush-start', 'import:flush-end', 'import:done', 'remove:commit'],
        imported: true,
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
