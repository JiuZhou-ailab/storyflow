// input: Simulated Storyflow loopback broker responses and hostile broker URLs
// output: Regression coverage for managed Source token resolution
// pos: Protects the first-party Source authentication trust boundary

import { describe, expect, test } from 'bun:test';
import {
  createStoryflowManagedTokenGetter,
  resolveStoryflowManagedAccess,
  STORYFLOW_MODEL_ACCESS_BROKER_TOKEN_ENV,
  STORYFLOW_MODEL_ACCESS_BROKER_URL_ENV,
} from '../managed-access.ts';
import { getTrustedManagedSourcePolicy } from '../managed-source-policy.ts';
import type { LoadedSource } from '../types.ts';

const expectedGatewayBaseUrl = 'https://storyflow-model.zjding.com';

describe('Storyflow managed Source access', () => {
  test('exchanges only a loopback capability for the expected gateway token', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const getter = createStoryflowManagedTokenGetter({
      expectedGatewayBaseUrl,
      env: {
        [STORYFLOW_MODEL_ACCESS_BROKER_URL_ENV]: 'http://127.0.0.1:43123/v1/model-access-token',
        [STORYFLOW_MODEL_ACCESS_BROKER_TOKEN_ENV]: 'local-capability',
      },
      fetchImpl: Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ input: String(input), init });
        return Response.json({
          gatewayBaseUrl: expectedGatewayBaseUrl,
          modelAccessToken: 'short-lived-token',
        });
      }, { preconnect: fetch.preconnect }),
    });

    expect(await getter()).toBe('short-lived-token');
    expect(calls[0]?.input).toBe('http://127.0.0.1:43123/v1/model-access-token');
    expect(calls[0]?.init?.headers).toMatchObject({ Authorization: 'Bearer local-capability' });
    expect(calls[0]?.init?.body).toBe('{"forceRefresh":false}');
  });

  test('rejects a non-loopback broker before sending its capability', async () => {
    let requested = false;
    await expect(resolveStoryflowManagedAccess({
      expectedGatewayBaseUrl,
      env: {
        [STORYFLOW_MODEL_ACCESS_BROKER_URL_ENV]: 'https://attacker.example/token',
        [STORYFLOW_MODEL_ACCESS_BROKER_TOKEN_ENV]: 'local-capability',
      },
      fetchImpl: Object.assign(async () => {
        requested = true;
        return Response.json({});
      }, { preconnect: fetch.preconnect }),
    })).rejects.toThrow('loopback');
    expect(requested).toBe(false);
  });

  test('rejects a broker token issued for another gateway', async () => {
    await expect(resolveStoryflowManagedAccess({
      expectedGatewayBaseUrl,
      env: {
        [STORYFLOW_MODEL_ACCESS_BROKER_URL_ENV]: 'http://localhost:43123/token',
        [STORYFLOW_MODEL_ACCESS_BROKER_TOKEN_ENV]: 'local-capability',
      },
      fetchImpl: Object.assign(async () => Response.json({
        gatewayBaseUrl: 'https://other.example.com',
        modelAccessToken: 'short-lived-token',
      }), { preconnect: fetch.preconnect }),
    })).rejects.toThrow('does not match');
  });

  test('keeps managed authentication bound to the immutable built-in Catalog surface', () => {
    const source: LoadedSource = {
      config: {
        id: 'builtin-storyflow-catalog',
        name: 'Storyflow Catalog',
        slug: 'storyflow-catalog',
        enabled: true,
        provider: 'storyflow',
        type: 'api',
        api: {
          baseUrl: expectedGatewayBaseUrl,
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
      guide: null,
      folderPath: '/global/sources/storyflow-catalog',
      workspaceRootPath: '/global',
      workspaceId: 'global',
      definitionIdentity: 'test-definition',
      origin: 'craft-global',
    };

    expect(getTrustedManagedSourcePolicy(source)).toEqual({ gatewayBaseUrl: expectedGatewayBaseUrl });
    expect(() => getTrustedManagedSourcePolicy({ ...source, origin: 'workspace' }))
      .toThrow('not available');
    expect(() => getTrustedManagedSourcePolicy({
      ...source,
      config: {
        ...source.config,
        api: {
          ...source.config.api!,
          operations: [
            ...source.config.api!.operations!,
            { name: 'chat', description: 'Call a model.', method: 'POST', path: '/v1/responses' },
          ],
        },
      },
    })).toThrow('not available');
  });
});
