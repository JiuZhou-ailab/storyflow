/**
 * input: A live Source definition and a credential-store write delayed across definition removal/replacement
 * output: Regression coverage that stale credential writes are removed and rejected
 * pos: Isolated SourceCredentialManager definition-liveness race test
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { CredentialId, StoredCredential } from '../../credentials/types.ts';
import { getSourceDefinitionIdentity } from '../storage.ts';
import type { FolderSourceConfig, LoadedSource } from '../types.ts';

const storedCredentials = new Map<string, StoredCredential>();
let setStarted: Promise<void>;
let resolveSetStarted: () => void;
let releaseSet: Promise<void>;
let resolveSet: () => void;

const credentialKey = (id: CredentialId): string => JSON.stringify(id);

const getCredential = mock(async () => null as StoredCredential | null);
const setCredential = mock(async (id: CredentialId, credential: StoredCredential) => {
  resolveSetStarted();
  await releaseSet;
  storedCredentials.set(credentialKey(id), credential);
});
const deleteCredential = mock(async (id: CredentialId) => (
  storedCredentials.delete(credentialKey(id))
));

mock.module('../../credentials/index.ts', () => ({
  getCredentialManager: () => ({
    get: getCredential,
    set: setCredential,
    delete: deleteCredential,
  }),
}));

const {
  SourceCredentialManager,
  StaleSourceDefinitionError,
} = await import('../credential-manager.ts');

function createSource(): LoadedSource {
  const config: FolderSourceConfig = {
    id: 'source-v1',
    name: 'Test Source',
    slug: 'test-source',
    enabled: true,
    provider: 'custom-api',
    type: 'api',
    api: {
      baseUrl: 'https://api.example.com',
      authType: 'bearer',
      renewEndpoint: { path: '/auth/refresh' },
    },
  };

  return {
    config,
    guide: null,
    folderPath: '/mock/workspace/.craft-agent/sources/test-source',
    workspaceRootPath: '/mock/workspace',
    workspaceId: 'project-id',
    definitionIdentity: getSourceDefinitionIdentity(config),
    origin: 'workspace',
  };
}

describe('SourceCredentialManager definition liveness', () => {
  let currentConfig: FolderSourceConfig | null;
  let source: LoadedSource;
  let manager: InstanceType<typeof SourceCredentialManager>;
  const originalFetch = globalThis.fetch;
  const updateSourceConnectionState = mock(() => true);

  beforeEach(() => {
    storedCredentials.clear();
    setCredential.mockClear();
    deleteCredential.mockClear();
    getCredential.mockClear();
    getCredential.mockImplementation(async () => null);
    updateSourceConnectionState.mockClear();
    setStarted = new Promise(resolve => { resolveSetStarted = resolve; });
    releaseSet = new Promise(resolve => { resolveSet = resolve; });
    source = createSource();
    currentConfig = source.config;
    manager = new SourceCredentialManager({
      loadSourceConfig: () => currentConfig,
      updateSourceConnectionState,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('removes and rejects a credential written after the definition is deleted', async () => {
    const credentialId = manager.getCredentialId(source);
    const save = manager.save(source, { value: 'stale-token' });

    await setStarted;
    currentConfig = null;
    resolveSet();

    await expect(save).rejects.toBeInstanceOf(StaleSourceDefinitionError);
    expect(setCredential).toHaveBeenCalledTimes(1);
    expect(deleteCredential).toHaveBeenCalledWith(credentialId);
    expect(storedCredentials.has(credentialKey(credentialId))).toBe(false);
  });

  test('removes and rejects a credential written after the definition is replaced', async () => {
    const credentialId = manager.getCredentialId(source);
    const save = manager.save(source, { value: 'stale-token' });

    await setStarted;
    currentConfig = {
      ...source.config,
      id: 'source-v2',
      api: {
        ...source.config.api!,
        baseUrl: 'https://replacement.example.com',
      },
    };
    resolveSet();

    await expect(save).rejects.toBeInstanceOf(StaleSourceDefinitionError);
    expect(setCredential).toHaveBeenCalledTimes(1);
    expect(deleteCredential).toHaveBeenCalledWith(credentialId);
    expect(storedCredentials.has(credentialKey(credentialId))).toBe(false);
  });

  test('reports stale credential cleanup that cannot be confirmed', async () => {
    const credentialId = manager.getCredentialId(source);
    deleteCredential.mockImplementationOnce(async () => false);
    const save = manager.save(source, { value: 'stale-token' });

    await setStarted;
    currentConfig = null;
    resolveSet();

    await expect(save).rejects.toBeInstanceOf(AggregateError);
    expect(deleteCredential).toHaveBeenCalledWith(credentialId);
    expect(storedCredentials.has(credentialKey(credentialId))).toBe(true);
  });

  test('does not apply a stale refresh failure to a replacement definition', async () => {
    let markFetchStarted!: () => void;
    let finishFetch!: () => void;
    const fetchStarted = new Promise<void>(resolve => { markFetchStarted = resolve; });
    const fetchGate = new Promise<void>(resolve => { finishFetch = resolve; });
    getCredential.mockImplementationOnce(async () => ({
      value: 'old-token',
      expiresAt: Date.now() - 60_000,
    }));
    globalThis.fetch = mock(async () => {
      markFetchStarted();
      await fetchGate;
      return new Response(JSON.stringify({ access_token: 'refreshed-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof globalThis.fetch;

    const refresh = manager.refresh(source);
    await fetchStarted;
    currentConfig = {
      ...source.config,
      id: 'source-v2',
      api: {
        ...source.config.api!,
        baseUrl: 'https://replacement.example.com',
      },
    };
    finishFetch();

    expect(await refresh).toBeNull();
    expect(setCredential).not.toHaveBeenCalled();
    expect(updateSourceConnectionState).not.toHaveBeenCalled();
    expect(currentConfig.connectionStatus).toBeUndefined();
  });

  test('does not mark a replacement connected after the old credential save completes', async () => {
    const save = manager.save(source, { value: 'old-definition-token' });
    await setStarted;
    resolveSet();
    await save;

    currentConfig = {
      ...source.config,
      id: 'source-v2',
      api: {
        ...source.config.api!,
        baseUrl: 'https://replacement.example.com',
      },
    };
    expect(() => manager.markSourceAuthenticated(source)).toThrow(StaleSourceDefinitionError);

    expect(updateSourceConnectionState).not.toHaveBeenCalled();
    expect(currentConfig.connectionStatus).toBeUndefined();
  });

  test('persists an explicit revocation and rejects a replacement definition', () => {
    manager.markSourceRevoked(source);
    expect(updateSourceConnectionState).toHaveBeenCalledWith(
      source.workspaceRootPath,
      source.config.slug,
      {
        isAuthenticated: false,
        connectionStatus: 'needs_auth',
        connectionError: 'Signed out by user',
      },
    );

    currentConfig = {
      ...source.config,
      id: 'source-v2',
      api: {
        ...source.config.api!,
        baseUrl: 'https://replacement.example.com',
      },
    };
    expect(() => manager.markSourceRevoked(source)).toThrow(StaleSourceDefinitionError);
  });
});
