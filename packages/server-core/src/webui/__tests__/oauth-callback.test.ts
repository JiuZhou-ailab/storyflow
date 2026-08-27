import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createWebuiHandler } from '../http-server';
import { loadSource } from '@craft-agent/shared/sources';

const TEMP_DIRS: string[] = [];

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as any;

function createTestWebuiDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'craft-webui-oauth-test-'));
  TEMP_DIRS.push(dir);
  writeFileSync(join(dir, 'login.html'), '<!doctype html><html><body>login</body></html>');
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body>app</body></html>');
  return dir;
}

afterEach(() => {
  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('WebUI /api/oauth/callback', () => {
  it('completes OAuth when the relay forwards the inner flow state', async () => {
    const webuiDir = createTestWebuiDir();
    const sourceDir = join(webuiDir, '.craft-agent', 'sources', 'gmail');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, 'config.json'), JSON.stringify({
      id: 'gmail', slug: 'gmail', name: 'Gmail', provider: 'google', type: 'api', enabled: true,
      api: { baseUrl: 'https://gmail.googleapis.com', authType: 'oauth' }, createdAt: 1, updatedAt: 1,
    }));
    const source = loadSource(webuiDir, 'gmail', 'workspace-1');
    if (!source) throw new Error('test Source not loaded');
    const flow = {
      flowId: 'flow-1',
      state: 'inner-state-123',
      codeVerifier: 'verifier',
      redirectUri: 'https://agents.craft.do/auth/callback',
      source,
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      provider: 'google',
      ownerClientId: 'client-1',
      workspaceId: 'workspace-1',
      sourceSlug: 'gmail',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    const flows = new Map([[flow.state, flow]]);

    const handler = createWebuiHandler({
      webuiDir,
      secret: 'test-secret',
      password: 'test-password',
      wsProtocol: 'wss',
      wsPort: 9100,
      getHealthCheck: () => ({ status: 'ok' }),
      logger,
    });

    handler.setOAuthCallbackDeps({
      flowStore: {
        getByState: (state: string) => flows.get(state) ?? null,
        claim: (state: string) => {
          const claimed = flows.get(state) ?? null;
          flows.delete(state);
          return claimed;
        },
        remove: (state: string) => {
          flows.delete(state);
        },
      },
      credManager: {
        exchangeAndStore: async () => ({ success: true, email: 'gyula@craft.do' }),
      },
      sessionManager: {
        completeAuthRequest: async () => {},
        withProjectOperation: async (_projectId, work) => work({
          id: 'workspace-1', name: 'Workspace', slug: 'workspace', rootPath: webuiDir, createdAt: 1,
        }),
      },
      pushSourcesChanged: () => {},
    });

    try {
      const response = await handler.fetch(
        new Request('http://127.0.0.1/api/oauth/callback?code=auth-code-123&state=inner-state-123'),
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('Authorization Successful');
      expect(flows.has('inner-state-123')).toBe(false);
    } finally {
      handler.dispose();
    }
  });

  it('renders an OAuth failure page when the relay forwards provider errors', async () => {
    const flow = {
      state: 'inner-state-456',
    };
    const flows = new Map([[flow.state, flow]]);

    const handler = createWebuiHandler({
      webuiDir: createTestWebuiDir(),
      secret: 'test-secret',
      password: 'test-password',
      wsProtocol: 'wss',
      wsPort: 9100,
      getHealthCheck: () => ({ status: 'ok' }),
      logger,
    });

    handler.setOAuthCallbackDeps({
      flowStore: {
        getByState: (state: string) => flows.get(state) ?? null,
        claim: () => null,
        remove: (state: string) => {
          flows.delete(state);
        },
      },
      credManager: {
        exchangeAndStore: async () => ({ success: true }),
      },
      sessionManager: {
        completeAuthRequest: async () => {},
        withProjectOperation: async () => { throw new Error('not reached'); },
      },
      pushSourcesChanged: () => {},
    });

    try {
      const response = await handler.fetch(
        new Request('http://127.0.0.1/api/oauth/callback?error=access_denied&error_description=User%20denied&state=inner-state-456'),
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('Authorization Failed');
      expect(flows.has('inner-state-456')).toBe(false);
    } finally {
      handler.dispose();
    }
  });
});
