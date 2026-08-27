// input: Manual webhook execution concurrent with Host automation revocation
// output: Regression coverage that revocation drains an accepted external action
// pos: Guards the Project Automation execution capability boundary

import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runIsolatedJson } from '../../sessions/isolated-test-runner'

const AUTOMATIONS_HANDLER_PATH = pathToFileURL(join(import.meta.dir, 'automations.ts')).href
const SESSION_MANAGER_PATH = pathToFileURL(join(import.meta.dir, '..', '..', 'sessions', 'SessionManager.ts')).href

describe('Project Automation execution lifecycle', () => {
  it('drains an accepted test webhook before Host revocation returns', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-automation-webhook-lifecycle-'))
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
      const result = runIsolatedJson(configDir, 'AUTOMATION_WEBHOOK_LIFECYCLE', `
          import { registerAutomationsHandlers } from '${AUTOMATIONS_HANDLER_PATH}';
          import { SessionManager } from '${SESSION_MANAGER_PATH}';
          import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
          const handlers = new Map();
          const manager = new SessionManager();
          const logger = { info() {}, warn() {}, error() {}, debug() {} };
          registerAutomationsHandlers(
            { handle: (channel, handler) => handlers.set(channel, handler), push() {} },
            { platform: { logger }, sessionManager: manager },
          );
          let markFetchStarted;
          let finishFetch;
          const fetchStarted = new Promise(resolve => { markFetchStarted = resolve; });
          const fetchGate = new Promise(resolve => { finishFetch = resolve; });
          let fetchCount = 0;
          globalThis.fetch = async () => {
            fetchCount += 1;
            markFetchStarted();
            await fetchGate;
            return new Response('ok', { status: 200 });
          };

          const testing = handlers.get(RPC_CHANNELS.automations.TEST)(null, {
            workspaceId: 'project-1',
            actions: [{ type: 'webhook', url: 'https://example.test/hook' }],
          });
          await fetchStarted;
          const revoking = manager.updateProjectHostSetting(
            'project-1', 'automationsEnabled', false,
          );
          const stateBeforeRelease = await Promise.race([
            revoking.then(() => 'revoked'),
            Bun.sleep(100).then(() => 'blocked'),
          ]);
          finishFetch();
          await testing;
          await revoking;
          const enabled = manager.getWorkspaces()[0].automationsEnabled;
          manager.cleanup();
          console.log('AUTOMATION_WEBHOOK_LIFECYCLE=' + JSON.stringify({
            stateBeforeRelease, fetchCount, enabled,
          }));
        `)
      expect(result).toEqual({
        stateBeforeRelease: 'blocked',
        fetchCount: 1,
        enabled: false,
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('does not read or mutate automation config and history through Project symlinks', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-automation-storage-boundary-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    const outsideRoot = join(parent, 'outside')
    mkdirSync(join(projectRoot, '.craft-agent'), { recursive: true })
    mkdirSync(configDir, { recursive: true })
    mkdirSync(outsideRoot, { recursive: true })
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
    const outsideConfig = join(outsideRoot, 'automations.json')
    const outsideHistory = join(outsideRoot, 'automations-history.jsonl')
    const configSentinel = JSON.stringify({ automations: { LabelAdd: [{ id: 'secret', enabled: true }] } })
    const historySentinel = `${JSON.stringify({ id: 'secret', ts: 1, ok: true })}\n`
    writeFileSync(outsideConfig, configSentinel)
    writeFileSync(outsideHistory, historySentinel)
    symlinkSync(outsideConfig, join(projectRoot, 'automations.json'))
    symlinkSync(outsideHistory, join(projectRoot, 'automations-history.jsonl'))

    try {
      const result = runIsolatedJson(configDir, 'AUTOMATION_STORAGE_BOUNDARY', `
          import { registerAutomationsHandlers } from '${AUTOMATIONS_HANDLER_PATH}';
          import { SessionManager } from '${SESSION_MANAGER_PATH}';
          import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
          const handlers = new Map();
          const manager = new SessionManager();
          const logger = { info() {}, warn() {}, error() {}, debug() {} };
          registerAutomationsHandlers(
            { handle: (channel, handler) => handlers.set(channel, handler), push() {} },
            { platform: { logger }, sessionManager: manager },
          );
          const getError = await handlers.get(RPC_CHANNELS.automations.GET)(null, 'project-1')
            .then(() => null, error => error.message);
          const mutateError = await handlers.get(RPC_CHANNELS.automations.SET_ENABLED)(
            null, 'project-1', 'LabelAdd', 0, false,
          ).then(() => null, error => error.message);
          const history = await handlers.get(RPC_CHANNELS.automations.GET_HISTORY)(
            null, 'project-1', 'secret', 20,
          );
          const last = await handlers.get(RPC_CHANNELS.automations.GET_LAST_EXECUTED)(
            null, 'project-1',
          );
          manager.cleanup();
          console.log('AUTOMATION_STORAGE_BOUNDARY=' + JSON.stringify({
            getError, mutateError, history, last,
          }));
        `)
      expect(result).toEqual({
        getError: expect.stringContaining('symbolic link'),
        mutateError: expect.stringContaining('symbolic link'),
        history: [],
        last: {},
      })
      expect(readFileSync(outsideConfig, 'utf-8')).toBe(configSentinel)
      expect(readFileSync(outsideHistory, 'utf-8')).toBe(historySentinel)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
