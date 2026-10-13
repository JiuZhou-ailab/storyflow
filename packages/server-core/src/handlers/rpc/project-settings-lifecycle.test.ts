// input: Project default RPC concurrent with a relink lifecycle
// output: Regression coverage for current-root resolution and mutation serialization
// pos: Guards Project settings from stale locator writes

import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runIsolatedJson } from '../../sessions/isolated-test-runner'

const LLM_HANDLER_PATH = pathToFileURL(join(import.meta.dir, 'llm-connections.ts')).href
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

describe('Project settings RPC lifecycle', () => {
  it('waits for relink and writes the workspace default to the committed root', () => {
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
          import { registerLlmConnectionsHandlers } from '${LLM_HANDLER_PATH}';
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
          const stateBeforeRelease = await Promise.race([
            setting.then(() => 'completed'),
            Bun.sleep(100).then(() => 'blocked'),
          ]);
          finishLifecycle();
          await relocation;
          const settingResult = await setting;
          manager.cleanup();

          console.log('SETTINGS_GIT_RELINK=' + JSON.stringify({
            stateBeforeRelease,
            activeRoot: loadStoredConfig().workspaces[0].rootPath,
            settingSuccess: settingResult.success,
            previousDefault: loadWorkspaceConfig(${JSON.stringify(previousRoot)})?.defaults?.defaultLlmConnection ?? null,
            currentDefault: loadWorkspaceConfig(${JSON.stringify(currentRoot)})?.defaults?.defaultLlmConnection ?? null,
          }));
        `)
      expect(result).toEqual({
        stateBeforeRelease: 'blocked',
        activeRoot: currentRoot,
        settingSuccess: true,
        previousDefault: 'old-default',
        currentDefault: null,
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
