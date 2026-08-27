// input: Global/project Source shadowing plus Host default Source capability settings
// output: Origin-bound grants and delete/recreate revocation behavior
// pos: Regression coverage for Project Source capability identity

import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runIsolatedJson } from './isolated-test-runner'

const SETTINGS_HANDLER_PATH = pathToFileURL(join(import.meta.dir, '..', 'handlers', 'rpc', 'settings.ts')).href
const SOURCES_HANDLER_PATH = pathToFileURL(join(import.meta.dir, '..', 'handlers', 'rpc', 'sources.ts')).href
const SOURCE_BRIDGE_PATH = pathToFileURL(join(import.meta.dir, 'source-bridge.ts')).href
const SESSION_MANAGER_PATH = pathToFileURL(join(import.meta.dir, 'SessionManager.ts')).href
const AUTH_FLOW_PATH = pathToFileURL(join(import.meta.dir, 'auth-flow.ts')).href

function writeSource(rootPath: string, slug: string): void {
  const sourceDir = join(rootPath, '.craft-agent', 'sources', slug)
  mkdirSync(sourceDir, { recursive: true })
  writeFileSync(join(sourceDir, 'config.json'), JSON.stringify({
    id: slug, slug, name: slug, type: 'api', enabled: true,
    api: { baseUrl: 'https://example.com', authType: 'none' },
  }))
}

function writeGlobalSource(configDir: string, slug: string): void {
  const sourceDir = join(configDir, 'sources', slug)
  mkdirSync(sourceDir, { recursive: true })
  writeFileSync(join(sourceDir, 'config.json'), JSON.stringify({
    id: slug, slug, name: slug, type: 'api', enabled: true,
    api: { baseUrl: 'https://example.com', authType: 'none' },
  }))
}

describe('Project Source grants', () => {
  it('does not save a credential after its pending Source grant is revoked', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-pending-credential-revoke-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    mkdirSync(join(projectRoot, '.craft-agent'), { recursive: true })
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(projectRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'directory-id', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
    }))
    const sourceDir = join(projectRoot, '.craft-agent', 'sources', 'foo')
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(join(sourceDir, 'config.json'), JSON.stringify({
      id: 'foo', slug: 'foo', name: 'Foo', type: 'api', enabled: true,
      api: { baseUrl: 'https://example.com', authType: 'bearer' },
    }))
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-1', name: 'Project', slug: 'project', rootPath: projectRoot,
        createdAt: 1, directoryConfigId: 'directory-id', defaultEnabledSourceRefs: [],
      }],
      activeWorkspaceId: 'project-1', activeSessionId: null,
    }))

    try {
      const result = runIsolatedJson(configDir, 'PENDING_CREDENTIAL_REVOKE', `
          import { AuthFlow } from '${AUTH_FLOW_PATH}';
          import { createManagedSession } from '${SESSION_MANAGER_PATH}';
          import { getSourceCredentialManager } from '@craft-agent/shared/sources';
          import { resolveRuntimeWorkspace } from '@craft-agent/shared/workspaces';
          const managed = createManagedSession(
            { id: 'session-1', name: 'Session' },
            resolveRuntimeWorkspace('project-1'),
            { messagesLoaded: true, enabledSourceSlugs: [] },
          );
          managed.pendingAuthRequestId = 'request-1';
          managed.pendingAuthRequest = {
            type: 'credential', requestId: 'request-1', sessionId: managed.id,
            sourceSlug: 'foo', sourceName: 'Foo', mode: 'bearer',
          };
          const credentialManager = getSourceCredentialManager();
          const originalSave = credentialManager.save.bind(credentialManager);
          const originalMark = credentialManager.markSourceAuthenticated.bind(credentialManager);
          let saves = 0;
          credentialManager.save = async () => { saves++; };
          credentialManager.markSourceAuthenticated = () => {};
          const messages = [];
          const flow = new AuthFlow({
            getSession: () => managed,
            sendEvent() {},
            persistSession() {},
            withAgentRuntimeLock: async (_managed, work) => work(),
            sendMessage: async (_id, message) => { messages.push(message); },
          });
          await flow.handleCredentialInput('session-1', 'request-1', {
            cancelled: false, value: 'secret',
          });
          credentialManager.save = originalSave;
          credentialManager.markSourceAuthenticated = originalMark;
          console.log('PENDING_CREDENTIAL_REVOKE=' + JSON.stringify({
            saves,
            enabledSourceSlugs: managed.enabledSourceSlugs,
            message: messages[0],
          }));
        `)
      expect(result).toEqual({
        saves: 0,
        enabledSourceSlugs: [],
        message: expect.stringContaining('not enabled by Host settings'),
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('does not transfer a global grant to a Project shadow and revokes deleted definitions', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-source-grants-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    mkdirSync(join(projectRoot, '.craft-agent'), { recursive: true })
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(projectRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'directory-id', name: 'Project', slug: 'project',
      defaults: { enabledSourceSlugs: ['foo'] }, createdAt: 1, updatedAt: 1,
    }))
    writeSource(projectRoot, 'foo')
    const ungrantedMcpDir = join(projectRoot, '.craft-agent', 'sources', 'ungranted-mcp')
    mkdirSync(ungrantedMcpDir, { recursive: true })
    writeFileSync(join(ungrantedMcpDir, 'config.json'), JSON.stringify({
      id: 'ungranted-mcp', slug: 'ungranted-mcp', name: 'Ungrant MCP', type: 'mcp', enabled: true,
      connectionStatus: 'untested',
      mcp: { transport: 'http', url: 'https://replacement.example/mcp', authType: 'none' },
    }))
    writeGlobalSource(configDir, 'foo')
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-1', name: 'Project', slug: 'project', rootPath: projectRoot,
        createdAt: 1, directoryConfigId: 'directory-id',
        defaultEnabledSourceRefs: ['craft-global:foo'],
      }],
      activeWorkspaceId: 'project-1', activeSessionId: null,
    }))

    try {
      const result = runIsolatedJson(configDir, 'GRANT_RESULT', `
          import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
          import { join } from 'node:path';
          import { registerSettingsHandlers } from '${SETTINGS_HANDLER_PATH}';
          import { registerSourcesHandlers } from '${SOURCES_HANDLER_PATH}';
          import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
          import { loadWorkspaceSources } from '@craft-agent/shared/sources';
          import { resolveRuntimeWorkspace } from '@craft-agent/shared/workspaces';
          import { buildServersFromSources } from '${SOURCE_BRIDGE_PATH}';
          import { SessionManager, createManagedSession } from '${SESSION_MANAGER_PATH}';
          const handlers = new Map();
          const server = { handle: (channel, handler) => handlers.set(channel, handler) };
          const logger = { info() {}, warn() {}, error() {}, debug() {} };
          const manager = new SessionManager();
          const deps = { platform: { logger }, sessionManager: manager };
          registerSettingsHandlers(server, deps);
          registerSourcesHandlers(server, deps);
          const before = await handlers.get(RPC_CHANNELS.workspace.SETTINGS_GET)(null, 'project-1');
          const ungrantedMcp = await handlers.get(RPC_CHANNELS.sources.GET_MCP_TOOLS)(null, 'project-1', 'ungranted-mcp');
          await handlers.get(RPC_CHANNELS.workspace.SETTINGS_UPDATE)(null, 'project-1', 'enabledSourceSlugs', ['foo']);
          const explicitlyGranted = JSON.parse(readFileSync(join(${JSON.stringify(configDir)}, 'config.json'), 'utf8')).workspaces[0].defaultEnabledSourceRefs;
          const runtimeWorkspace = resolveRuntimeWorkspace('project-1');
          const managed = createManagedSession(
            { id: 'session-1', name: 'Session' },
            runtimeWorkspace,
            { messagesLoaded: true, enabledSourceSlugs: ['foo'] },
          );
          const applied = [];
          managed.agent = {
            getSummarizeCallback: () => async () => null,
            setAllSources() {},
            applyBridgeUpdates: async () => {},
            setSourceServers: async (_mcp, _api, slugs) => { applied.push(slugs); },
          };
          manager['sessions'].set(managed.id, managed);
          const configPath = join(${JSON.stringify(projectRoot)}, '.craft-agent', 'sources', 'foo', 'config.json');
          const replacedConfig = JSON.parse(readFileSync(configPath, 'utf8'));
          replacedConfig.api.baseUrl = 'https://replacement.example.com';
          writeFileSync(configPath, JSON.stringify(replacedConfig));
          const afterReplacement = await handlers.get(RPC_CHANNELS.workspace.SETTINGS_GET)(null, 'project-1');
          const builtAfterReplacement = await buildServersFromSources(
            loadWorkspaceSources(${JSON.stringify(projectRoot)}, 'project-1'),
            undefined,
            undefined,
            undefined,
            runtimeWorkspace,
          );
          await handlers.get(RPC_CHANNELS.sources.DELETE)(null, 'project-1', 'foo');
          const afterDelete = JSON.parse(readFileSync(join(${JSON.stringify(configDir)}, 'config.json'), 'utf8')).workspaces[0].defaultEnabledSourceRefs;
          const projectDefaults = JSON.parse(readFileSync(join(${JSON.stringify(projectRoot)}, '.craft-agent', 'config.json'), 'utf8')).defaults.enabledSourceSlugs;
          const sourceDir = join(${JSON.stringify(projectRoot)}, '.craft-agent', 'sources', 'foo');
          mkdirSync(sourceDir, { recursive: true });
          writeFileSync(join(sourceDir, 'config.json'), JSON.stringify({ id: 'foo-2', slug: 'foo', name: 'foo', type: 'api', enabled: true, api: { baseUrl: 'https://example.com', authType: 'none' } }));
          const afterRecreate = await handlers.get(RPC_CHANNELS.workspace.SETTINGS_GET)(null, 'project-1');
          console.log('GRANT_RESULT=' + JSON.stringify({
            before: before.enabledSourceSlugs,
            ungrantedMcpError: ungrantedMcp.error,
            explicitlyGranted,
            afterReplacement: afterReplacement.enabledSourceSlugs,
            executableAfterReplacement: builtAfterReplacement.resolvedSources.map(source => source.config.slug),
            afterDelete,
            runningSessionSlugs: managed.enabledSourceSlugs,
            applied,
            projectDefaults,
            afterRecreate: afterRecreate.enabledSourceSlugs,
          }));
          manager.cleanup();
        `)
      expect(result).toEqual({
        before: [],
        ungrantedMcpError: 'Source is not enabled by Host settings',
        explicitlyGranted: [expect.stringMatching(/^workspace:foo:[a-f0-9]{64}$/)],
        afterReplacement: [],
        executableAfterReplacement: [],
        afterDelete: [],
        runningSessionSlugs: [],
        applied: [[]],
        projectDefaults: ['foo'],
        afterRecreate: [],
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('deletes a global Source from its owning store and revokes every Project grant', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-global-source-delete-'))
    const configDir = join(parent, 'host')
    const firstRoot = join(parent, 'first')
    const secondRoot = join(parent, 'second')
    for (const [rootPath, id] of [[firstRoot, 'directory-first'], [secondRoot, 'directory-second']] as const) {
      mkdirSync(join(rootPath, '.craft-agent'), { recursive: true })
      writeFileSync(join(rootPath, '.craft-agent', 'config.json'), JSON.stringify({
        id, name: id, slug: id, createdAt: 1, updatedAt: 1,
      }))
    }
    mkdirSync(configDir, { recursive: true })
    writeGlobalSource(configDir, 'shared-global')
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [
        { id: 'project-first', name: 'First', slug: 'first', rootPath: firstRoot, createdAt: 1, directoryConfigId: 'directory-first' },
        { id: 'project-second', name: 'Second', slug: 'second', rootPath: secondRoot, createdAt: 1, directoryConfigId: 'directory-second' },
      ],
      activeWorkspaceId: 'project-first', activeSessionId: null,
    }))

    try {
      const result = runIsolatedJson(configDir, 'GLOBAL_DELETE_RESULT', `
          import { existsSync, readFileSync } from 'node:fs';
          import { join } from 'node:path';
          import { registerSettingsHandlers } from '${SETTINGS_HANDLER_PATH}';
          import { registerSourcesHandlers } from '${SOURCES_HANDLER_PATH}';
          import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
          import { SessionManager } from '${SESSION_MANAGER_PATH}';
          const handlers = new Map();
          const server = { handle: (channel, handler) => handlers.set(channel, handler) };
          const logger = { info() {}, warn() {}, error() {}, debug() {} };
          const deps = { platform: { logger }, sessionManager: new SessionManager() };
          registerSettingsHandlers(server, deps);
          registerSourcesHandlers(server, deps);
          for (const projectId of ['project-first', 'project-second']) {
            await handlers.get(RPC_CHANNELS.workspace.SETTINGS_UPDATE)(null, projectId, 'enabledSourceSlugs', ['shared-global']);
          }
          await handlers.get(RPC_CHANNELS.sources.DELETE)(null, 'project-first', 'shared-global');
          const config = JSON.parse(readFileSync(join(${JSON.stringify(configDir)}, 'config.json'), 'utf8'));
          console.log('GLOBAL_DELETE_RESULT=' + JSON.stringify({
            sourceExists: existsSync(join(${JSON.stringify(configDir)}, 'sources', 'shared-global', 'config.json')),
            refs: config.workspaces.map(workspace => workspace.defaultEnabledSourceRefs),
          }));
        `)
      expect(result).toEqual({ sourceExists: false, refs: [[], []] })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('revokes a running Session source runtime when the Host grant changes', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-running-source-revoke-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    mkdirSync(join(projectRoot, '.craft-agent'), { recursive: true })
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(projectRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'directory-id', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
    }))
    writeSource(projectRoot, 'foo')
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-1', name: 'Project', slug: 'project', rootPath: projectRoot,
        createdAt: 1, directoryConfigId: 'directory-id', defaultEnabledSourceRefs: [],
      }],
      activeWorkspaceId: 'project-1', activeSessionId: null,
    }))

    try {
      const result = runIsolatedJson(configDir, 'RUNNING_REVOKE_RESULT', `
          import { SessionManager, createManagedSession } from '${SESSION_MANAGER_PATH}';
          import { resolveRuntimeWorkspace } from '@craft-agent/shared/workspaces';
          const manager = new SessionManager();
          await manager.updateProjectHostSetting('project-1', 'enabledSourceSlugs', ['foo']);
          const workspace = resolveRuntimeWorkspace('project-1');
          const managed = createManagedSession(
            { id: 'session-1', name: 'Session' },
            workspace,
            { messagesLoaded: true, enabledSourceSlugs: ['foo'] },
          );
          const applied = [];
          managed.agent = {
            getSummarizeCallback: () => async () => null,
            setAllSources() {},
            applyBridgeUpdates: async () => {},
            setSourceServers: async (_mcp, _api, slugs) => { applied.push(slugs); },
          };
          manager['sessions'].set(managed.id, managed);
          await manager.updateProjectHostSetting('project-1', 'enabledSourceSlugs', []);
          console.log('RUNNING_REVOKE_RESULT=' + JSON.stringify({
            workspaceRefs: managed.workspace.defaultEnabledSourceRefs,
            enabledSlugs: managed.enabledSourceSlugs,
            applied,
          }));
          manager.cleanup();
        `)
      expect(result).toEqual({
        workspaceRefs: [],
        enabledSlugs: [],
        applied: [[]],
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
