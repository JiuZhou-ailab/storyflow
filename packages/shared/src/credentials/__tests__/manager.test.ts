// input: CredentialManager, mocked backends, and isolated connection configuration
// output: Regression coverage for credential reads, deletion, and storage-health semantics
// pos: Guards shared credential storage orchestration without touching real user state

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CredentialManager } from '../manager.ts';
import type { CredentialBackend } from '../backends/types.ts';
import { credentialIdToAccount, type CredentialId, type StoredCredential } from '../types.ts';

const CREDENTIALS_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'index.ts')).href;

function createManagerWithBackend(backend: CredentialBackend): CredentialManager {
  const manager = new CredentialManager();
  const writable = manager as unknown as {
    backends: CredentialBackend[];
    writeBackend: CredentialBackend;
    initialized: boolean;
  };
  writable.backends = [backend];
  writable.writeBackend = backend;
  writable.initialized = true;
  return manager;
}

describe('CredentialManager', () => {
  it('reports a credential backend decryption failure as unhealthy', async () => {
    const backend: CredentialBackend = {
      name: 'mock',
      priority: 1,
      isAvailable: async () => true,
      get: async () => null,
      set: async () => {},
      delete: async () => false,
      list: async () => { throw new Error('authentication tag mismatch'); },
    };
    const manager = createManagerWithBackend(backend);

    expect(await manager.checkHealth()).toEqual({
      healthy: false,
      issues: [{
        type: 'decryption_failed',
        message: 'Credentials from another machine detected. Please re-authenticate.',
        error: 'authentication tag mismatch',
      }],
    });
  });

  it('treats an empty readable store as healthy when provider credentials are not configured', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-credential-health-'));
    try {
      writeFileSync(join(configDir, 'config.json'), JSON.stringify({
        workspaces: [],
        activeWorkspaceId: null,
        activeSessionId: null,
        defaultLlmConnection: 'custom-provider',
        llmConnections: [{
          slug: 'custom-provider',
          name: 'Custom Provider',
          providerType: 'pi',
          authType: 'api_key',
          createdAt: Date.now(),
        }],
      }));

      const run = Bun.spawnSync([
        process.execPath,
        '--eval',
        `const { getCredentialManager } = await import('${CREDENTIALS_MODULE_PATH}'); console.log(JSON.stringify(await getCredentialManager().checkHealth()));`,
      ], {
        env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      expect(run.exitCode).toBe(0);
      expect(JSON.parse(run.stdout.toString())).toEqual({ healthy: true, issues: [] });
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('coalesces concurrent reads for the same credential id without caching completed reads', async () => {
    const id: CredentialId = { type: 'llm_api_key', connectionSlug: 'default' };
    const stored: StoredCredential = { value: 'sk-test' };
    let getCalls = 0;
    let resolveRead: (value: StoredCredential) => void;
    const pendingRead = new Promise<StoredCredential>((resolve) => {
      resolveRead = resolve;
    });

    const backend: CredentialBackend = {
      name: 'mock',
      priority: 1,
      isAvailable: async () => true,
      get: async () => {
        getCalls += 1;
        return pendingRead;
      },
      set: async () => {},
      delete: async () => false,
      list: async () => [],
    };
    const manager = createManagerWithBackend(backend);

    const first = manager.get(id);
    const second = manager.get(id);
    resolveRead!(stored);

    expect(await Promise.all([first, second])).toEqual([stored, stored]);
    expect(getCalls).toBe(1);

    await manager.get(id);
    expect(getCalls).toBe(2);
  });

  it('removes remote tokens from both encrypted storage and the synchronous cache', async () => {
    const stored = new Map<string, StoredCredential>();
    const backend: CredentialBackend = {
      name: 'mock',
      priority: 1,
      isAvailable: async () => true,
      get: async (id) => stored.get(credentialIdToAccount(id)) ?? null,
      set: async (id, credential) => { stored.set(credentialIdToAccount(id), credential); },
      delete: async (id) => stored.delete(credentialIdToAccount(id)),
      list: async () => [],
    };
    const manager = createManagerWithBackend(backend);

    await manager.setRemoteServerToken('workspace-1', 'secret');
    expect(manager.peekRemoteServerToken('workspace-1')).toBe('secret');
    expect(await manager.deleteRemoteServerToken('workspace-1')).toBe(true);
    expect(manager.peekRemoteServerToken('workspace-1')).toBeNull();
  });

  for (const failure of ['false', 'throw'] as const) {
    it(`rejects strict deletion when an existing credential backend returns ${failure}`, async () => {
      const id: CredentialId = {
        type: 'source_oauth',
        workspaceId: 'project-1',
        sourceId: 'source-1',
      };
      const backend: CredentialBackend = {
        name: 'mock',
        priority: 1,
        isAvailable: async () => true,
        get: async () => ({ value: 'secret', refreshToken: 'refresh' }),
        set: async () => {},
        delete: async () => {
          if (failure === 'throw') throw new Error('secure storage unavailable');
          return false;
        },
        list: async () => [id],
      };
      const manager = createManagerWithBackend(backend);

      await expect(manager.deleteStrict(id)).rejects.toThrow(
        'Credential deletion could not be confirmed',
      );
    });
  }
});
