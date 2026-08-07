/**
 * input: API Source config fixtures including auth and declarative operation contracts
 * output: Validation coverage for safe persisted Source configuration
 * pos: Source config trust-boundary regression tests
 *
 * These tests catch configuration mistakes that led to production bugs:
 * - authType: "none" with headerNames present (headers won't be applied)
 * - authType: "header" without headerNames for multi-header APIs
 */

import { describe, test, expect } from 'bun:test';
import { validateSourceConfig } from '../../config/validators.ts';
import type { FolderSourceConfig } from '../types.ts';

/**
 * Validate multi-header source config for common misconfigurations.
 * This function could be extracted to a validation module if needed.
 */
function validateMultiHeaderConfig(config: FolderSourceConfig): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  if (config.type !== 'api' || !config.api) {
    return { valid: true, warnings };
  }

  const api = config.api;

  // Bug case: headerNames present but authType is "none"
  // This means headers won't be applied to requests
  if (api.headerNames && api.headerNames.length > 0 && api.authType === 'none') {
    warnings.push(
      `Config has headerNames [${api.headerNames.join(', ')}] but authType is "none". ` +
      `Auth headers will NOT be applied. Set authType to "header" to use multi-header auth.`
    );
  }

  // Warning case: authType is "header" but no headerNames or headerName
  // This works but uses default 'x-api-key' header name
  if (api.authType === 'header' && !api.headerNames && !api.headerName) {
    warnings.push(
      `Config has authType "header" but no headerName or headerNames specified. ` +
      `Will use default header name "x-api-key".`
    );
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}

describe('Multi-header source config validation', () => {
  test('should detect headerNames with authType: "none" (our exact production bug)', () => {
    // This was the exact bug we hit - config had headerNames but authType was "none"
    const brokenConfig: FolderSourceConfig = {
      id: 'test-id',
      slug: 'datadog',
      name: 'Datadog',
      type: 'api',
      enabled: true,
      provider: 'datadog',
      api: {
        baseUrl: 'https://api.datadoghq.com/',
        authType: 'none', // BUG: should be 'header'
        headerNames: ['DD-API-KEY', 'DD-APPLICATION-KEY'],
      },
    };

    const result = validateMultiHeaderConfig(brokenConfig);

    expect(result.valid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('authType is "none"');
    expect(result.warnings[0]).toContain('DD-API-KEY');
  });

  test('should accept valid multi-header config', () => {
    const validConfig: FolderSourceConfig = {
      id: 'test-id',
      slug: 'datadog',
      name: 'Datadog',
      type: 'api',
      enabled: true,
      provider: 'datadog',
      api: {
        baseUrl: 'https://api.datadoghq.com/',
        authType: 'header',
        headerNames: ['DD-API-KEY', 'DD-APPLICATION-KEY'],
      },
    };

    const result = validateMultiHeaderConfig(validConfig);

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  test('should warn when authType: "header" has no header name specified', () => {
    const configWithoutHeaderName: FolderSourceConfig = {
      id: 'test-id',
      slug: 'my-api',
      name: 'My API',
      type: 'api',
      enabled: true,
      provider: 'custom',
      api: {
        baseUrl: 'https://api.example.com/',
        authType: 'header',
        // Missing both headerName and headerNames
      },
    };

    const result = validateMultiHeaderConfig(configWithoutHeaderName);

    expect(result.valid).toBe(false);
    expect(result.warnings[0]).toContain('x-api-key');
  });

  test('should accept single header config with headerName', () => {
    const singleHeaderConfig: FolderSourceConfig = {
      id: 'test-id',
      slug: 'my-api',
      name: 'My API',
      type: 'api',
      enabled: true,
      provider: 'custom',
      api: {
        baseUrl: 'https://api.example.com/',
        authType: 'header',
        headerName: 'X-API-Key',
      },
    };

    const result = validateMultiHeaderConfig(singleHeaderConfig);

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  test('should accept config with authType: "none" and NO headerNames', () => {
    // This is valid - public API with no auth
    const publicApiConfig: FolderSourceConfig = {
      id: 'test-id',
      slug: 'public-api',
      name: 'Public API',
      type: 'api',
      enabled: true,
      provider: 'custom',
      api: {
        baseUrl: 'https://api.example.com/',
        authType: 'none',
        // No headerNames - this is correct for public APIs
      },
    };

    const result = validateMultiHeaderConfig(publicApiConfig);

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  test('should skip validation for non-API sources', () => {
    const mcpConfig: FolderSourceConfig = {
      id: 'test-id',
      slug: 'mcp-source',
      name: 'MCP Source',
      type: 'mcp',
      enabled: true,
      provider: 'custom',
      mcp: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'some-mcp-server'],
      },
    };

    const result = validateMultiHeaderConfig(mcpConfig);

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('Real-world API config examples', () => {
  test('Datadog config should be valid', () => {
    const datadogConfig: FolderSourceConfig = {
      id: 'datadog_f8c2a91b',
      slug: 'datadog',
      name: 'Datadog',
      type: 'api',
      enabled: true,
      provider: 'datadog',
      api: {
        baseUrl: 'https://api.datadoghq.com/',
        authType: 'header',
        headerNames: ['DD-API-KEY', 'DD-APPLICATION-KEY'],
        testEndpoint: {
          method: 'GET',
          path: 'api/v1/validate',
        },
      },
    };

    const result = validateMultiHeaderConfig(datadogConfig);
    expect(result.valid).toBe(true);
  });

  test('Algolia config should be valid', () => {
    const algoliaConfig: FolderSourceConfig = {
      id: 'algolia_123',
      slug: 'algolia',
      name: 'Algolia',
      type: 'api',
      enabled: true,
      provider: 'algolia',
      api: {
        baseUrl: 'https://api.algolia.com/',
        authType: 'header',
        headerNames: ['X-Algolia-API-Key', 'X-Algolia-Application-ID'],
      },
    };

    const result = validateMultiHeaderConfig(algoliaConfig);
    expect(result.valid).toBe(true);
  });

  test('Cloudflare config should be valid', () => {
    const cloudflareConfig: FolderSourceConfig = {
      id: 'cloudflare_123',
      slug: 'cloudflare',
      name: 'Cloudflare',
      type: 'api',
      enabled: true,
      provider: 'cloudflare',
      api: {
        baseUrl: 'https://api.cloudflare.com/client/v4/',
        authType: 'header',
        headerNames: ['X-Auth-Key', 'X-Auth-Email'],
      },
    };

    const result = validateMultiHeaderConfig(cloudflareConfig);
    expect(result.valid).toBe(true);
  });
});

describe('Declarative API operation config validation', () => {
  const managedCatalogConfig = {
    id: 'storyflow-catalog',
    slug: 'storyflow-catalog',
    name: 'Storyflow Catalog',
    type: 'api',
    enabled: true,
    provider: 'storyflow',
    api: {
      baseUrl: 'https://storyflow-model.zjding.com',
      authType: 'managed',
      operations: [{
        name: 'get_conversion_manifest',
        description: 'Get the normalized manifest for one source series.',
        method: 'GET',
        path: '/v2/series/{source}/{sourceSeriesId}/manifest',
        parameters: [
          { name: 'source', type: 'string', required: true },
          { name: 'sourceSeriesId', type: 'string', required: true },
        ],
      }],
    },
  } as const;

  test('accepts managed auth and bounded typed operations', () => {
    expect(validateSourceConfig(managedCatalogConfig).valid).toBe(true);
  });

  test('rejects duplicate tool names', () => {
    const operation = managedCatalogConfig.api.operations[0];
    const config = {
      ...managedCatalogConfig,
      api: {
        ...managedCatalogConfig.api,
        operations: [operation, operation],
      },
    };

    const result = validateSourceConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.message.includes('Duplicate API operation name'))).toBe(true);
  });

  test('rejects unresolved path placeholders', () => {
    const config = {
      ...managedCatalogConfig,
      api: {
        ...managedCatalogConfig.api,
        operations: [{
          ...managedCatalogConfig.api.operations[0],
          parameters: [{ name: 'source', type: 'string', required: true }],
        }],
      },
    };

    const result = validateSourceConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.message.includes('sourceSeriesId'))).toBe(true);
  });

  test('rejects managed auth outside the Storyflow host boundary', () => {
    const result = validateSourceConfig({
      ...managedCatalogConfig,
      provider: 'custom',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.path === 'provider')).toBe(true);
  });
});
