// input: Project default/Git RPCs concurrent with relink/remove lifecycles
// output: Regression coverage for current-root resolution and mutation serialization
// pos: Guards Project settings and version history from stale locator writes

import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runIsolatedJson } from '../../sessions/isolated-test-runner'

const LLM_HANDLER_PATH = pathToFileURL(join(import.meta.dir, 'llm-connections.ts')).href
const SYSTEM_HANDLER_PATH = pathToFileURL(join(import.meta.dir, 'system.ts')).href
const SESSION_MANAGER_PATH = pathToFileURL(join(import.meta.dir, '..', '..', 'sessions', 'SessionManager.ts')).href

function writeProjectConfig(rootPath: string, directoryConfigId = 'directory-id'): void {
  mkdirSync(join(rootPath, '.craft-agent'), { recursive: true })
  writeFileSync(join(rootPath, '.craft-agent', 'config.json'), JSON.stringify({
    id: directoryConfigId,
    name: 'Project',
    slug: 'project',
    createdAt: 1,
    updatedAt: 1,
    defaults: { defaultLlmConnection: 'old-default' },
  }))
  writeFileSync(join(rootPath, 'story.md'), '# Story\n')
}

describe('Project settings and Git RPC lifecycle', () => {
  it('waits for relink and writes the workspace default/version to the committed root', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-settings-git-relink-'))
    const configDir = join(parent, 'host')
    const previousRoot = join(parent, 'previous')
    const currentRoot = join(parent, 'current')
    mkdirSync(configDir, { recursive: true })
    writeProjectConfig(previousRoot)
    writeProjectConfig(currentRoot)
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-1', name: 'Project', slug: 'project', rootPath: previousRoot,
        createdAt: 1, directoryConfigId: 'directory-id',
      }],
      activeWorkspaceId: 'project-1', activeSessionId: null,
    }))

    try {
      const result = runIsolatedJson(configDir, 'SETTINGS_GIT_RELINK', `
          import { existsSync } from 'node:fs';
          import { join } from 'node:path';
          import { registerLlmConnectionsHandlers } from '${LLM_HANDLER_PATH}';
          import { registerSystemCoreHandlers } from '${SYSTEM_HANDLER_PATH}';
          import { SessionManager } from '${SESSION_MANAGER_PATH}';
          import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
          import { loadStoredConfig, saveConfig } from '@craft-agent/shared/config';
          import { loadWorkspaceConfig } from '@craft-agent/shared/workspaces';
          const handlers = new Map();
          const server = { handle: (channel, handler) => handlers.set(channel, handler), push() {}, async invokeClient() {} };
          const logger = { info() {}, warn() {}, error() {}, debug() {} };
          const manager = new SessionManager();
          const deps = {
            platform: { logger, isPackaged: false },
            sessionManager: manager,
            windowManager: { getWorkspaceForWindow: () => 'stale-window-project' },
          };
          registerLlmConnectionsHandlers(server, deps);
          registerSystemCoreHandlers(server, deps);

          let markLifecycleStarted;
          let finishLifecycle;
          const lifecycleStarted = new Promise(resolve => { markLifecycleStarted = resolve; });
          const lifecycleGate = new Promise(resolve => { finishLifecycle = resolve; });
          const relocation = manager.withProjectLifecycle('project-1', async () => {
            markLifecycleStarted();
            await lifecycleGate;
            const config = loadStoredConfig();
            config.workspaces[0].rootPath = ${JSON.stringify(currentRoot)};
            saveConfig(config);
          });
          await lifecycleStarted;

          const ctx = { clientId: 'client-1', workspaceId: 'stale-project', webContentsId: 7 };
          const setting = handlers.get(RPC_CHANNELS.llmConnections.SET_WORKSPACE_DEFAULT)(
            ctx, 'project-1', null,
          );
          const versioning = handlers.get(RPC_CHANNELS.git.CREATE_VERSION)(
            ctx, ${JSON.stringify(previousRoot)}, { reason: 'manual' },
          );
          const operations = Promise.all([setting, versioning]);
          const stateBeforeRelease = await Promise.race([
            operations.then(() => 'completed'),
            Bun.sleep(100).then(() => 'blocked'),
          ]);
          finishLifecycle();
          await relocation;
          const [settingResult, versionResult] = await operations;
          manager.cleanup();

          console.log('SETTINGS_GIT_RELINK=' + JSON.stringify({
            stateBeforeRelease,
            activeRoot: loadStoredConfig().workspaces[0].rootPath,
            settingSuccess: settingResult.success,
            previousDefault: loadWorkspaceConfig(${JSON.stringify(previousRoot)})?.defaults?.defaultLlmConnection ?? null,
            currentDefault: loadWorkspaceConfig(${JSON.stringify(currentRoot)})?.defaults?.defaultLlmConnection ?? null,
            previousGitCreated: existsSync(join(${JSON.stringify(previousRoot)}, '.git')),
            currentGitCreated: existsSync(join(${JSON.stringify(currentRoot)}, '.git')),
            versionCreated: versionResult.created,
          }));
        `)
      expect(result).toEqual({
        stateBeforeRelease: 'blocked',
        activeRoot: currentRoot,
        settingSuccess: true,
        previousDefault: 'old-default',
        currentDefault: null,
        previousGitCreated: false,
        currentGitCreated: true,
        versionCreated: true,
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('finishes an accepted restore before Project removal', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-git-restore-remove-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    mkdirSync(configDir, { recursive: true })
    writeProjectConfig(projectRoot)
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-1', name: 'Project', slug: 'project', rootPath: projectRoot,
        createdAt: 1, directoryConfigId: 'directory-id',
      }],
      activeWorkspaceId: 'project-1', activeSessionId: null,
    }))

    try {
      const result = runIsolatedJson(configDir, 'GIT_RESTORE_REMOVE', `
          import { readFileSync, writeFileSync } from 'node:fs';
          import { registerSystemCoreHandlers } from '${SYSTEM_HANDLER_PATH}';
          import { SessionManager } from '${SESSION_MANAGER_PATH}';
          import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
          import { loadStoredConfig } from '@craft-agent/shared/config';
          import { createWorkspaceVersion } from '@craft-agent/server-core/services';
          const first = await createWorkspaceVersion(${JSON.stringify(projectRoot)}, { reason: 'manual' });
          writeFileSync(${JSON.stringify(join(projectRoot, 'story.md'))}, '# Changed\\n');
          await createWorkspaceVersion(${JSON.stringify(projectRoot)}, { reason: 'manual' });

          const handlers = new Map();
          const server = { handle: (channel, handler) => handlers.set(channel, handler), push() {}, async invokeClient() {} };
          const logger = { info() {}, warn() {}, error() {}, debug() {} };
          const manager = new SessionManager();
          const originalWithProjectLifecycle = manager.withProjectLifecycle.bind(manager);
          let markRestoreStarted;
          let finishRestore;
          const restoreStarted = new Promise(resolve => { markRestoreStarted = resolve; });
          const restoreGate = new Promise(resolve => { finishRestore = resolve; });
          manager.withProjectLifecycle = (projectId, work) => originalWithProjectLifecycle(
            projectId,
            async workspace => {
              markRestoreStarted();
              await restoreGate;
              return work(workspace);
            },
          );
          registerSystemCoreHandlers(server, { platform: { logger, isPackaged: false }, sessionManager: manager });

          const ctx = { clientId: 'client-1', workspaceId: 'project-1', webContentsId: null };
          const restoring = handlers.get(RPC_CHANNELS.git.RESTORE_VERSION)(
            ctx, ${JSON.stringify(projectRoot)}, first.commitHash,
          );
          const lifecycleEntered = await Promise.race([
            restoreStarted.then(() => true),
            restoring.then(() => false),
            Bun.sleep(100).then(() => false),
          ]);
          if (!lifecycleEntered) {
            await restoring;
            manager.cleanup();
            console.log('GIT_RESTORE_REMOVE=' + JSON.stringify({ lifecycleEntered }));
          } else {
            const removal = manager.removeWorkspace('project-1');
            const stateBeforeRelease = await Promise.race([
              removal.then(() => 'removed'),
              Bun.sleep(100).then(() => 'blocked'),
            ]);
            finishRestore();
            await restoring;
            await removal;
            manager.cleanup();
            console.log('GIT_RESTORE_REMOVE=' + JSON.stringify({
              lifecycleEntered,
              stateBeforeRelease,
              projectRemoved: loadStoredConfig().workspaces.length === 0,
              content: readFileSync(${JSON.stringify(join(projectRoot, 'story.md'))}, 'utf8'),
            }));
          }
        `)
      expect(result).toEqual({
        lifecycleEntered: true,
        stateBeforeRelease: 'blocked',
        projectRemoved: true,
        content: '# Story\n',
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('keeps remote Electron version creation in its context Project', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-git-remote-scope-'))
    const configDir = join(parent, 'host')
    const projectARoot = join(parent, 'project-a')
    const projectBRoot = join(parent, 'project-b')
    mkdirSync(configDir, { recursive: true })
    writeProjectConfig(projectARoot, 'directory-a')
    writeProjectConfig(projectBRoot, 'directory-b')
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [
        {
          id: 'project-a', name: 'Project A', slug: 'project-a', rootPath: projectARoot,
          createdAt: 1, directoryConfigId: 'directory-a',
        },
        {
          id: 'project-b', name: 'Project B', slug: 'project-b', rootPath: projectBRoot,
          createdAt: 2, directoryConfigId: 'directory-b',
        },
      ],
      activeWorkspaceId: 'project-a', activeSessionId: null,
    }))

    try {
      const result = runIsolatedJson(configDir, 'GIT_REMOTE_SCOPE', `
          import { existsSync } from 'node:fs';
          import { join } from 'node:path';
          import { registerSystemCoreHandlers } from '${SYSTEM_HANDLER_PATH}';
          import { SessionManager } from '${SESSION_MANAGER_PATH}';
          import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
          const handlers = new Map();
          const server = { handle: (channel, handler) => handlers.set(channel, handler), push() {}, async invokeClient() {} };
          const logger = { info() {}, warn() {}, error() {}, debug() {} };
          const manager = new SessionManager();
          registerSystemCoreHandlers(server, { platform: { logger, isPackaged: false }, sessionManager: manager });

          const version = await handlers.get(RPC_CHANNELS.git.CREATE_VERSION)(
            { clientId: 'remote-client', workspaceId: 'project-a', webContentsId: 77 },
            ${JSON.stringify(projectBRoot)},
            { reason: 'manual' },
          );
          manager.cleanup();
          console.log('GIT_REMOTE_SCOPE=' + JSON.stringify({
            created: version.created,
            projectAGitCreated: existsSync(join(${JSON.stringify(projectARoot)}, '.git')),
            projectBGitCreated: existsSync(join(${JSON.stringify(projectBRoot)}, '.git')),
          }));
        `)
      expect(result).toEqual({
        created: true,
        projectAGitCreated: true,
        projectBGitCreated: false,
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
