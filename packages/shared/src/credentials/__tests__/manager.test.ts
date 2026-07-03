// input: CredentialManager and a mocked credential backend
// output: Regression coverage for duplicate in-flight credential reads
// pos: Guards shared credential storage orchestration without touching real secure storage

import { describe, expect, it } from 'bun:test';
import { CredentialManager } from '../manager.ts';
import type { CredentialBackend } from '../backends/types.ts';
import type { CredentialId, StoredCredential } from '../types.ts';

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
});
