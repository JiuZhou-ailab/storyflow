// input: OAuth completion concurrent with a Project locator transition
// output: Regression coverage that credentials bind only to the committed Source definition
// pos: Guards the OAuth exchange/credential mutation boundary from stale Project roots

import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runIsolatedJson } from '../../sessions/isolated-test-runner'

const OAUTH_HANDLER_PATH = pathToFileURL(join(import.meta.dir, 'oauth.ts')).href
const SESSION_MANAGER_PATH = pathToFileURL(join(import.meta.dir, '..', '..', 'sessions', 'SessionManager.ts')).href

function writeProject(rootPath: string): void {
  const sourceDir = join(rootPath, '.craft-agent', 'sources', 'foo')
  mkdirSync(sourceDir, { recursive: true })
  writeFileSync(join(rootPath, '.craft-agent', 'config.json'), JSON.stringify({
    id: 'directory-id', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
  }))
  writeFileSync(join(sourceDir, 'config.json'), JSON.stringify({
    id: 'foo', slug: 'foo', name: 'Foo', provider: 'custom', type: 'api', enabled: true,
    api: { baseUrl: 'https://example.com', authType: 'oauth' }, createdAt: 1, updatedAt: 1,
  }))
}

describe('OAuth Project lifecycle', () => {
  it('waits for relink and exchanges against the exact Source at the committed root', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-oauth-lifecycle-'))
    const configDir = join(parent, 'host')
    const previousRoot = join(parent, 'previous')
    const currentRoot = join(parent, 'current')
    mkdirSync(configDir, { recursive: true })
    writeProject(previousRoot)
    writeProject(currentRoot)
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-1', name: 'Project', slug: 'project', rootPath: previousRoot,
        createdAt: 1, directoryConfigId: 'directory-id',
      }],
      activeWorkspaceId: 'project-1', activeSessionId: null,
    }))

    try {
      const result = runIsolatedJson(configDir, 'OAUTH_LIFECYCLE', `
          import { completeOAuthFlow } from '${OAUTH_HANDLER_PATH}';
          import { SessionManager } from '${SESSION_MANAGER_PATH}';
          import { loadSource } from '@craft-agent/shared/sources';
          import { loadStoredConfig, saveConfig } from '@craft-agent/shared/config';
          const manager = new SessionManager();
          const source = loadSource(${JSON.stringify(previousRoot)}, 'foo', 'project-1');
          const flow = {
            flowId: 'flow-1', state: 'state-1', source, provider: 'generic',
            workspaceId: 'project-1', sourceSlug: 'foo', ownerClientId: 'client-1',
          };
          let claimed = false;
          let exchangedRoot = null;
          let markTransitionStarted;
          let finishTransition;
          const transitionStarted = new Promise(resolve => { markTransitionStarted = resolve; });
          const transitionGate = new Promise(resolve => { finishTransition = resolve; });
          const transition = manager.withProjectLifecycle('project-1', async () => {
            markTransitionStarted();
            await transitionGate;
            const config = loadStoredConfig();
            config.workspaces[0].rootPath = ${JSON.stringify(currentRoot)};
            saveConfig(config);
          });
          await transitionStarted;
          const completion = completeOAuthFlow({
            code: 'code', state: 'state-1',
            flowStore: {
              getByState: () => flow,
              claim: () => { claimed = true; return flow; },
            },
            credManager: {
              exchangeAndStore: async currentSource => {
                exchangedRoot = currentSource.workspaceRootPath;
                return { success: true };
              },
            },
            sessionManager: manager,
            pushSourcesChanged() {},
            logger: { info() {} },
            clientId: 'client-1', workspaceId: 'project-1',
          });
          const stateBeforeRelease = await Promise.race([
            completion.then(() => 'completed'),
            Bun.sleep(100).then(() => 'blocked'),
          ]);
          finishTransition();
          await transition;
          await completion;
          manager.cleanup();
          console.log('OAUTH_LIFECYCLE=' + JSON.stringify({ stateBeforeRelease, exchangedRoot, claimed }));
        `)
      expect(result).toEqual({
        stateBeforeRelease: 'blocked',
        exchangedRoot: currentRoot,
        claimed: true,
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('drains an accepted completion before revocation invalidates flows and deletes every credential form', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-oauth-revoke-lifecycle-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    mkdirSync(configDir, { recursive: true })
    writeProject(projectRoot)
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-1', name: 'Project', slug: 'project', rootPath: projectRoot,
        createdAt: 1, directoryConfigId: 'directory-id',
      }],
      activeWorkspaceId: 'project-1', activeSessionId: null,
    }))

    try {
      const result = runIsolatedJson(configDir, 'OAUTH_REVOKE', `
          import { completeOAuthFlow, revokeOAuthSource } from '${OAUTH_HANDLER_PATH}';
          import { SessionManager } from '${SESSION_MANAGER_PATH}';
          import { loadSource } from '@craft-agent/shared/sources';
          const manager = new SessionManager();
          const source = loadSource(${JSON.stringify(projectRoot)}, 'foo', 'project-1');
          const makeFlow = (state) => ({
            flowId: 'flow-' + state, state, source, provider: 'generic',
            workspaceId: 'project-1', sourceSlug: 'foo', ownerClientId: 'client-1',
          });
          const flows = new Map([
            ['completing', makeFlow('completing')],
            ['pending', makeFlow('pending')],
          ]);
          const order = [];
          const flowStore = {
            getByState: state => flows.get(state) ?? null,
            claim: state => {
              const flow = flows.get(state) ?? null;
              flows.delete(state);
              return flow;
            },
            removeForSource: (workspaceId, sourceSlug) => {
              order.push('flows-invalidated');
              for (const [state, flow] of flows) {
                if (flow.workspaceId === workspaceId && flow.sourceSlug === sourceSlug) flows.delete(state);
              }
            },
          };
          let markExchangeStarted;
          let finishExchange;
          const exchangeStarted = new Promise(resolve => { markExchangeStarted = resolve; });
          const exchangeGate = new Promise(resolve => { finishExchange = resolve; });
          const credManager = {
            exchangeAndStore: async () => {
              order.push('exchange-started');
              markExchangeStarted();
              await exchangeGate;
              order.push('credential-stored');
              return { success: true };
            },
            deleteAllStrict: async () => { order.push('credentials-deleted'); },
            markSourceRevoked: () => { order.push('source-revoked'); },
          };
          manager.reconcileProjectSourceGrants = async () => { order.push('runtime-reconciled'); };

          const completion = completeOAuthFlow({
            code: 'code', state: 'completing', flowStore, credManager,
            sessionManager: manager, pushSourcesChanged() {}, logger: { info() {} },
            clientId: 'client-1', workspaceId: 'project-1',
          });
          await exchangeStarted;
          const revocation = revokeOAuthSource({
            workspaceId: 'project-1', sourceSlug: 'foo', flowStore, credManager,
            sessionManager: manager,
          });
          const stateBeforeRelease = await Promise.race([
            revocation.then(() => 'revoked'),
            Bun.sleep(100).then(() => 'blocked'),
          ]);
          finishExchange();
          await completion;
          await revocation;
          manager.cleanup();
          console.log('OAUTH_REVOKE=' + JSON.stringify({
            stateBeforeRelease, order, pendingFlow: flows.has('pending'),
          }));
        `)
      expect(result).toEqual({
        stateBeforeRelease: 'blocked',
        order: [
          'exchange-started',
          'credential-stored',
          'flows-invalidated',
          'credentials-deleted',
          'source-revoked',
          'runtime-reconciled',
        ],
        pendingFlow: false,
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('does not mark or reconcile a Source when strict credential deletion fails', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-oauth-revoke-failure-'))
    const projectRoot = join(parent, 'project')
    writeProject(projectRoot)
    let markedRevoked = false
    let reconciled = false

    try {
      const { revokeOAuthSource } = await import('./oauth')
      let bestEffortDeleteCalled = false
      const credManager = {
        // The old best-effort contract must not authorize a successful revoke.
        deleteAll: async () => {
          bestEffortDeleteCalled = true
          return false
        },
        deleteAllStrict: async () => {
          throw new Error('Credential deletion could not be confirmed')
        },
        markSourceRevoked: () => { markedRevoked = true },
      }
      const revocation = revokeOAuthSource({
        workspaceId: 'project-1',
        sourceSlug: 'foo',
        flowStore: { removeForSource() {} },
        credManager,
        sessionManager: {
          withProjectExclusiveOperation: async (_workspaceId, work) => work({
            id: 'project-1',
            rootPath: projectRoot,
          } as never),
          reconcileProjectSourceGrants: async () => { reconciled = true },
        },
      })

      await expect(revocation).rejects.toThrow('Credential deletion could not be confirmed')
      expect(bestEffortDeleteCalled).toBe(false)
      expect(markedRevoked).toBe(false)
      expect(reconciled).toBe(false)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
