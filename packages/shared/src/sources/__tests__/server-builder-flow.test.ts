/**
 * input: Workspace-owned API Source fixtures and credential variants
 * output: SourceServerBuilder to request-header integration coverage
 * pos: API Source server construction flow test
 *
 * Verifies that credentials flow correctly from:
 * 1. SourceServerBuilder.buildApiConfig() - creates correct auth config
 * 2. SourceServerBuilder.buildApiServer() - passes credential to createApiServer
 * 3. buildHeaders() - applies credentials to HTTP request headers
 */

import { describe, test, expect } from 'bun:test';
import { SourceServerBuilder } from '../server-builder.ts';
import { buildHeaders } from '../api-tools.ts';
import { isMultiHeaderCredential, type MultiHeaderCredential } from '../credential-manager.ts';
import type { LoadedSource, FolderSourceConfig, ApiConfig } from '../types.ts';

// Create a minimal mock LoadedSource for testing
function createMockSource(overrides: Partial<FolderSourceConfig> = {}): LoadedSource {
  return {
    config: {
      id: 'test-id',
      slug: 'test-source',
      name: 'Test Source',
      type: 'api',
      enabled: true,
      api: {
        baseUrl: 'https://api.example.com/',
        authType: 'header',
      },
      ...overrides,
    } as FolderSourceConfig,
    guide: null,
    folderPath: '/tmp/test/sources/test-source',
    workspaceRootPath: '/tmp/test',
    workspaceId: 'test-workspace',
    definitionIdentity: 'test-definition',
    origin: 'workspace',
  };
}

function createTrustedManagedSource(): LoadedSource {
  return {
    ...createMockSource(),
    origin: 'craft-global',
    config: {
      id: 'builtin-storyflow-catalog',
      slug: 'storyflow-catalog',
      name: 'Storyflow Catalog',
      provider: 'storyflow',
      type: 'api',
      enabled: true,
      api: {
        baseUrl: 'https://storyflow-model.zjding.com',
        authType: 'managed',
        testEndpoint: { method: 'GET', path: '/v2/catalog/sources' },
        operations: [
          { name: 'list_sources', description: 'List sources.', method: 'GET', path: '/v2/catalog/sources' },
          { name: 'list_ranking_snapshots', description: 'List snapshots.', method: 'GET', path: '/v2/ranking-snapshots' },
          { name: 'search_rankings', description: 'Search rankings.', method: 'GET', path: '/v2/rankings' },
          { name: 'get_conversion_manifest', description: 'Get manifest.', method: 'GET', path: '/v2/series/{source}/{sourceId}/manifest' },
        ],
      },
    },
  };
}

describe('SourceServerBuilder.buildApiConfig', () => {
  const builder = new SourceServerBuilder();

  test('should build correct ApiConfig.auth for header type', () => {
    const source = createMockSource({
      api: {
        baseUrl: 'https://api.example.com/',
        authType: 'header',
        headerName: 'X-API-Key',
      },
    });

    const config = builder.buildApiConfig(source);

    expect(config.auth?.type).toBe('header');
    expect(config.auth?.headerName).toBe('X-API-Key');
  });

  test('should build correct ApiConfig.auth for bearer type', () => {
    const source = createMockSource({
      api: {
        baseUrl: 'https://api.example.com/',
        authType: 'bearer',
      },
    });

    const config = builder.buildApiConfig(source);

    expect(config.auth?.type).toBe('bearer');
  });

  test('should build correct ApiConfig.auth for none type', () => {
    const source = createMockSource({
      api: {
        baseUrl: 'https://api.example.com/',
        authType: 'none',
      },
    });

    const config = builder.buildApiConfig(source);

    expect(config.auth?.type).toBe('none');
  });

  test('should use default headerName when not specified', () => {
    const source = createMockSource({
      api: {
        baseUrl: 'https://api.example.com/',
        authType: 'header',
        // No headerName specified
      },
    });

    const config = builder.buildApiConfig(source);

    expect(config.auth?.type).toBe('header');
    expect(config.auth?.headerName).toBe('x-api-key');
  });

  test('should include baseUrl in config', () => {
    const source = createMockSource({
      api: {
        baseUrl: 'https://api.datadoghq.com/',
        authType: 'header',
      },
    });

    const config = builder.buildApiConfig(source);

    expect(config.baseUrl).toBe('https://api.datadoghq.com/');
  });

  test('should include defaultHeaders if present', () => {
    const source = createMockSource({
      api: {
        baseUrl: 'https://api.example.com/',
        authType: 'header',
        defaultHeaders: {
          'X-Custom-Header': 'custom-value',
        },
      },
    });

    const config = builder.buildApiConfig(source);

    expect(config.defaultHeaders).toEqual({
      'X-Custom-Header': 'custom-value',
    });
  });

  test('maps managed auth to bearer and preserves typed operations', () => {
    const operations = [{
      name: 'list_sources',
      description: 'List source freshness and coverage.',
      method: 'GET' as const,
      path: '/v2/catalog/sources',
    }];
    const source = createMockSource({
      provider: 'storyflow',
      api: {
        baseUrl: 'https://storyflow-model.zjding.com',
        authType: 'managed',
        operations,
      },
    });

    const config = builder.buildApiConfig(source);

    expect(config.auth).toEqual({ type: 'bearer', authScheme: 'Bearer' });
    expect(config.operations).toEqual(operations);
  });
});

describe('SourceServerBuilder project execution grants', () => {
  test('blocks only project-owned stdio Sources without Host consent', async () => {
    const projectSource = createMockSource({
      slug: 'project-local',
      type: 'mcp',
      mcp: { transport: 'stdio', command: 'project-command', authType: 'none' },
    });
    const globalSource: LoadedSource = {
      ...projectSource,
      origin: 'craft-global',
      config: { ...projectSource.config, slug: 'global-local' },
    };

    const result = await new SourceServerBuilder().buildAll(
      [{ source: projectSource }, { source: globalSource }],
      undefined,
      undefined,
      undefined,
    );

    expect(result.mcpServers).toEqual({
      'global-local': { type: 'stdio', command: 'project-command' },
    });

    const granted = await new SourceServerBuilder().buildAll(
      [{ source: projectSource }, { source: globalSource }],
      undefined,
      undefined,
      undefined,
      { allowProjectStdio: true },
    );
    expect(Object.keys(granted.mcpServers).sort()).toEqual(['global-local', 'project-local']);
  });
});

describe('SourceServerBuilder managed auth boundary', () => {
  const builder = new SourceServerBuilder();
  const untrustedSource = createMockSource({
    provider: 'storyflow',
    api: {
      baseUrl: 'https://storyflow-model.zjding.com',
      authType: 'managed',
    },
  });
  const trustedSource = createTrustedManagedSource();

  test('rejects managed authentication from a workspace Source', async () => {
    await expect(builder.buildApiServer(untrustedSource, null, async () => 'managed-token'))
      .rejects.toThrow('not available');
  });

  test('does not build the trusted managed Source without a host token getter', async () => {
    expect(await builder.buildApiServer(trustedSource, null)).toBeNull();
  });

  test('builds only the trusted managed Source without a per-Source credential', async () => {
    const server = await builder.buildApiServer(trustedSource, null, async () => 'managed-token');

    expect(server?.type).toBe('sdk');
    expect(server?.name).toBe('api_storyflow-catalog');
  });
});

describe('buildHeaders with MultiHeaderCredential', () => {
  test('should apply all headers from MultiHeaderCredential', () => {
    const credential: MultiHeaderCredential = {
      'DD-API-KEY': 'test-api-key',
      'DD-APPLICATION-KEY': 'test-app-key',
    };

    const auth: ApiConfig['auth'] = {
      type: 'header',
    };

    const headers = buildHeaders(auth, credential);

    expect(headers['DD-API-KEY']).toBe('test-api-key');
    expect(headers['DD-APPLICATION-KEY']).toBe('test-app-key');
    expect(headers['Content-Type']).toBe('application/json');
  });

  test('should NOT apply headers when auth type is "none"', () => {
    const credential: MultiHeaderCredential = {
      'DD-API-KEY': 'test-api-key',
      'DD-APPLICATION-KEY': 'test-app-key',
    };

    const auth: ApiConfig['auth'] = {
      type: 'none',
    };

    const headers = buildHeaders(auth, credential);

    // Headers should NOT be applied when auth type is 'none'
    expect(headers['DD-API-KEY']).toBeUndefined();
    expect(headers['DD-APPLICATION-KEY']).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/json');
  });

  test('isMultiHeaderCredential correctly identifies credential type', () => {
    const multiHeader: MultiHeaderCredential = {
      'DD-API-KEY': 'key',
      'DD-APPLICATION-KEY': 'app',
    };

    expect(isMultiHeaderCredential(multiHeader)).toBe(true);
    expect(isMultiHeaderCredential('string-credential')).toBe(false);
  });
});

describe('Full flow: Source config → ApiConfig → Headers', () => {
  const builder = new SourceServerBuilder();

  test('Datadog-like source produces correct headers', () => {
    // 1. Create source config
    const source = createMockSource({
      slug: 'datadog',
      api: {
        baseUrl: 'https://api.datadoghq.com/',
        authType: 'header',
        headerNames: ['DD-API-KEY', 'DD-APPLICATION-KEY'],
      },
    });

    // 2. Build API config
    const apiConfig = builder.buildApiConfig(source);
    expect(apiConfig.auth?.type).toBe('header');

    // 3. Simulate credential that would come from SourceCredentialManager
    const credential: MultiHeaderCredential = {
      'DD-API-KEY': 'my-api-key',
      'DD-APPLICATION-KEY': 'my-app-key',
    };

    // 4. Build headers
    const headers = buildHeaders(apiConfig.auth, credential);

    // 5. Verify both headers present
    expect(headers['DD-API-KEY']).toBe('my-api-key');
    expect(headers['DD-APPLICATION-KEY']).toBe('my-app-key');
  });

  test('BROKEN config (authType: none + headerNames) should NOT apply headers', () => {
    // This tests our exact production bug
    const brokenSource = createMockSource({
      slug: 'datadog',
      api: {
        baseUrl: 'https://api.datadoghq.com/',
        authType: 'none', // BUG: should be 'header'
        headerNames: ['DD-API-KEY', 'DD-APPLICATION-KEY'],
      },
    });

    // Build API config
    const apiConfig = builder.buildApiConfig(brokenSource);
    expect(apiConfig.auth?.type).toBe('none'); // This is the problem

    // Even with valid credentials...
    const credential: MultiHeaderCredential = {
      'DD-API-KEY': 'my-api-key',
      'DD-APPLICATION-KEY': 'my-app-key',
    };

    // Headers will NOT be applied because auth.type is 'none'
    const headers = buildHeaders(apiConfig.auth, credential);

    expect(headers['DD-API-KEY']).toBeUndefined();
    expect(headers['DD-APPLICATION-KEY']).toBeUndefined();
  });

  test('Single header source still works (backward compatibility)', () => {
    const source = createMockSource({
      api: {
        baseUrl: 'https://api.example.com/',
        authType: 'header',
        headerName: 'X-API-Key',
      },
    });

    const apiConfig = builder.buildApiConfig(source);
    const headers = buildHeaders(apiConfig.auth, 'my-simple-key');

    expect(headers['X-API-Key']).toBe('my-simple-key');
  });
});
