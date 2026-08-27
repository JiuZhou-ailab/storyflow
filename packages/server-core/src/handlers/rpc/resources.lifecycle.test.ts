// input: Resource import plus concurrent Project removal through the RPC boundary
// output: Regression coverage for shared Project lifecycle serialization
// pos: Guards Project-owned resource writes from stale-root lifecycle races

import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runIsolatedJson } from '../../sessions/isolated-test-runner'

const RESOURCE_HANDLER_PATH = pathToFileURL(join(import.meta.dir, 'resources.ts')).href
const SESSION_MANAGER_PATH = pathToFileURL(join(import.meta.dir, '..', '..', 'sessions', 'SessionManager.ts')).href

describe('resource import lifecycle', () => {
  it('resolves the Project root for export after an earlier lifecycle commit', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-resource-export-relink-'))
    const configDir = join(parent, 'host')
    const previousRoot = join(parent, 'previous')
    const currentRoot = join(parent, 'current')
    mkdirSync(configDir, { recursive: true })
    for (const [rootPath, baseUrl] of [
      [previousRoot, 'https://old.example'],
      [currentRoot, 'https://new.example'],
    ] as const) {
      const sourceDir = join(rootPath, '.craft-agent', 'sources', 'foo')
      mkdirSync(sourceDir, { recursive: true })
      writeFileSync(join(rootPath, '.craft-agent', 'config.json'), JSON.stringify({
        id: 'directory-id', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
      }))
      writeFileSync(join(sourceDir, 'config.json'), JSON.stringify({
        id: 'foo', slug: 'foo', name: 'Foo', provider: 'custom', type: 'api', enabled: true,
        api: { baseUrl, authType: 'none' }, createdAt: 1, updatedAt: 1,
      }))
    }
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-1', name: 'Project', slug: 'project', rootPath: previousRoot,
        createdAt: 1, directoryConfigId: 'directory-id',
      }],
      activeWorkspaceId: 'project-1', activeSessionId: null,
    }))

    try {
      const result = runIsolatedJson(configDir, 'RESOURCE_EXPORT_RELINK', `
          import { registerResourcesHandlers } from '${RESOURCE_HANDLER_PATH}';
          import { SessionManager } from '${SESSION_MANAGER_PATH}';
          import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
          import { loadStoredConfig, saveConfig } from '@craft-agent/shared/config';
          const handlers = new Map();
          const server = { handle: (channel, handler) => handlers.set(channel, handler), push() {} };
          const logger = { info() {}, warn() {}, error() {}, debug() {} };
          const manager = new SessionManager();
          registerResourcesHandlers(server, { platform: { logger }, sessionManager: manager });

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
          const exporting = handlers.get(RPC_CHANNELS.resources.EXPORT)(
            null, 'project-1', { sources: ['foo'] },
          );
          await Bun.sleep(50);
          finishLifecycle();
          await relocation;
          const exported = await exporting;
          console.log('RESOURCE_EXPORT_RELINK=' + JSON.stringify({
            baseUrl: exported.bundle.resources.sources[0].config.api.baseUrl,
          }));
          manager.cleanup();
        `)
      expect(result).toEqual({ baseUrl: 'https://new.example' })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('finishes an in-flight Project import before removing its Host registration', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-resource-lifecycle-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    const sourceDir = join(projectRoot, '.craft-agent', 'sources', 'foo')
    mkdirSync(sourceDir, { recursive: true })
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(projectRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'directory-id', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
    }))
    writeFileSync(join(sourceDir, 'config.json'), JSON.stringify({
      id: 'foo-old', slug: 'foo', name: 'Old Foo', provider: 'custom', type: 'api', enabled: true,
      api: { baseUrl: 'https://old.example', authType: 'none' }, createdAt: 1, updatedAt: 1,
    }))
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-1', name: 'Project', slug: 'project', rootPath: projectRoot,
        createdAt: 1, directoryConfigId: 'directory-id',
      }],
      activeWorkspaceId: 'project-1', activeSessionId: null,
    }))
    const bundle = {
      version: 1,
      exportedAt: 1,
      resources: {
        sources: [{
          slug: 'foo',
          config: {
            id: 'foo-new', slug: 'foo', name: 'New Foo', provider: 'custom', type: 'api', enabled: true,
            api: { baseUrl: 'https://new.example', authType: 'none' }, createdAt: 1, updatedAt: 1,
          },
          files: [],
        }],
      },
    }

    try {
      const result = runIsolatedJson(configDir, 'RESOURCE_LIFECYCLE', `
          import { registerResourcesHandlers } from '${RESOURCE_HANDLER_PATH}';
          import { SessionManager } from '${SESSION_MANAGER_PATH}';
          import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
          import { getSourceCredentialManager } from '@craft-agent/shared/sources';
          const handlers = new Map();
          const server = { handle: (channel, handler) => handlers.set(channel, handler), push() {} };
          const logger = { info() {}, warn() {}, error() {}, debug() {} };
          const manager = new SessionManager();
          registerResourcesHandlers(server, { platform: { logger }, sessionManager: manager });

          const credentialManager = getSourceCredentialManager();
          const originalDeleteAll = credentialManager.deleteAll.bind(credentialManager);
          let markCredentialCleanupStarted;
          let finishCredentialCleanup;
          const credentialCleanupStarted = new Promise(resolve => { markCredentialCleanupStarted = resolve; });
          const credentialCleanupGate = new Promise(resolve => { finishCredentialCleanup = resolve; });
          credentialManager.deleteAll = async () => {
            markCredentialCleanupStarted();
            await credentialCleanupGate;
          };

          const importing = handlers.get(RPC_CHANNELS.resources.IMPORT)(
            null, 'project-1', ${JSON.stringify(bundle)}, 'overwrite', {},
          );
          await credentialCleanupStarted;
          const removal = manager.removeWorkspace('project-1');
          const stateBeforeRelease = await Promise.race([
            removal.then(() => 'removed'),
            Bun.sleep(100).then(() => 'blocked'),
          ]);
          finishCredentialCleanup();
          await importing;
          await removal;
          credentialManager.deleteAll = originalDeleteAll;
          manager.cleanup();
          console.log('RESOURCE_LIFECYCLE=' + JSON.stringify({ stateBeforeRelease }));
        `)
      expect(result).toEqual({ stateBeforeRelease: 'blocked' })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('resolves the Project root after an earlier lifecycle commit', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-resource-relink-'))
    const configDir = join(parent, 'host')
    const previousRoot = join(parent, 'previous')
    const currentRoot = join(parent, 'current')
    mkdirSync(configDir, { recursive: true })
    for (const rootPath of [previousRoot, currentRoot]) {
      const sourceDir = join(rootPath, '.craft-agent', 'sources', 'foo')
      mkdirSync(sourceDir, { recursive: true })
      writeFileSync(join(rootPath, '.craft-agent', 'config.json'), JSON.stringify({
        id: 'directory-id', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
      }))
      writeFileSync(join(sourceDir, 'config.json'), JSON.stringify({
        id: 'foo-old', slug: 'foo', name: 'Old Foo', provider: 'custom', type: 'api', enabled: true,
        api: { baseUrl: 'https://old.example', authType: 'none' }, createdAt: 1, updatedAt: 1,
      }))
    }
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-1', name: 'Project', slug: 'project', rootPath: previousRoot,
        createdAt: 1, directoryConfigId: 'directory-id',
      }],
      activeWorkspaceId: 'project-1', activeSessionId: null,
    }))
    const bundle = {
      version: 1,
      exportedAt: 1,
      resources: {
        sources: [{
          slug: 'foo',
          config: {
            id: 'foo-new', slug: 'foo', name: 'New Foo', provider: 'custom', type: 'api', enabled: true,
            api: { baseUrl: 'https://new.example', authType: 'none' }, createdAt: 1, updatedAt: 1,
          },
          files: [],
        }],
      },
    }

    try {
      const result = runIsolatedJson(configDir, 'RESOURCE_RELINK', `
          import { readFileSync } from 'node:fs';
          import { join } from 'node:path';
          import { registerResourcesHandlers } from '${RESOURCE_HANDLER_PATH}';
          import { SessionManager } from '${SESSION_MANAGER_PATH}';
          import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
          import { loadStoredConfig, saveConfig } from '@craft-agent/shared/config';
          import { getSourceCredentialManager } from '@craft-agent/shared/sources';
          const handlers = new Map();
          const server = { handle: (channel, handler) => handlers.set(channel, handler), push() {} };
          const logger = { info() {}, warn() {}, error() {}, debug() {} };
          const manager = new SessionManager();
          registerResourcesHandlers(server, { platform: { logger }, sessionManager: manager });

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

          const credentialManager = getSourceCredentialManager();
          const originalDeleteAll = credentialManager.deleteAll.bind(credentialManager);
          let markCredentialCleanupStarted;
          let finishCredentialCleanup;
          const credentialCleanupStarted = new Promise(resolve => { markCredentialCleanupStarted = resolve; });
          const credentialCleanupGate = new Promise(resolve => { finishCredentialCleanup = resolve; });
          credentialManager.deleteAll = async () => {
            markCredentialCleanupStarted();
            await credentialCleanupGate;
          };

          const importing = handlers.get(RPC_CHANNELS.resources.IMPORT)(
            null, 'project-1', ${JSON.stringify(bundle)}, 'overwrite', {},
          );
          await Bun.sleep(50);
          finishLifecycle();
          await relocation;
          await credentialCleanupStarted;
          finishCredentialCleanup();
          await importing;

          const readBaseUrl = rootPath => JSON.parse(readFileSync(
            join(rootPath, '.craft-agent', 'sources', 'foo', 'config.json'),
            'utf8',
          )).api.baseUrl;
          console.log('RESOURCE_RELINK=' + JSON.stringify({
            previousBaseUrl: readBaseUrl(${JSON.stringify(previousRoot)}),
            currentBaseUrl: readBaseUrl(${JSON.stringify(currentRoot)}),
          }));
          credentialManager.deleteAll = originalDeleteAll;
          manager.cleanup();
        `)
      expect(result).toEqual({
        previousBaseUrl: 'https://old.example',
        currentBaseUrl: 'https://new.example',
      })
      expect(JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8')).workspaces[0].rootPath)
        .toBe(currentRoot)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
