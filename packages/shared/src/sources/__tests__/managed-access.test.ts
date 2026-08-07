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
});
