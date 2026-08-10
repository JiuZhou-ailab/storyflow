// input: A loaded Source that requests Storyflow-managed authentication
// output: An immutable first-party capability policy or a trust-boundary error
// pos: Host-owned allowlist separating bundled managed capabilities from user Source config

import type { LoadedSource } from './types.ts';

const STORYFLOW_CATALOG_OPERATIONS: Readonly<Record<string, readonly [string, string]>> = {
  list_sources: ['GET', '/v2/catalog/sources'],
  list_ranking_snapshots: ['GET', '/v2/ranking-snapshots'],
  search_rankings: ['GET', '/v2/rankings'],
  get_conversion_manifest: ['GET', '/v2/series/{source}/{sourceId}/manifest'],
};

export interface TrustedManagedSourcePolicy {
  gatewayBaseUrl: string;
}

function reject(source: LoadedSource): never {
  throw new Error(`Managed authentication is not available to Source "${source.config.slug}"`);
}

/** Resolve only the bundled Catalog contract; mutable Source config never defines token authority. */
export function getTrustedManagedSourcePolicy(source: LoadedSource): TrustedManagedSourcePolicy {
  const { config } = source;
  const api = config.api;
  if (
    source.origin !== 'craft-global'
    || config.id !== 'builtin-storyflow-catalog'
    || config.slug !== 'storyflow-catalog'
    || config.provider !== 'storyflow'
    || config.type !== 'api'
    || api?.authType !== 'managed'
  ) {
    return reject(source);
  }

  const gatewayBaseUrl = 'https://storyflow-model.zjding.com';
  let configuredGateway: URL;
  try {
    configuredGateway = new URL(api.baseUrl);
  } catch {
    return reject(source);
  }
  if (
    configuredGateway.origin !== gatewayBaseUrl
    || configuredGateway.pathname !== '/'
    || configuredGateway.search
    || configuredGateway.hash
    || configuredGateway.username
    || configuredGateway.password
  ) {
    return reject(source);
  }

  const allowedApiKeys = new Set(['baseUrl', 'authType', 'testEndpoint', 'operations']);
  if (Object.keys(api).some(key => !allowedApiKeys.has(key))) return reject(source);
  if (
    api.testEndpoint?.method !== 'GET'
    || api.testEndpoint.path !== '/v2/catalog/sources'
    || api.testEndpoint.body
    || api.testEndpoint.headers
  ) {
    return reject(source);
  }

  const operations = api.operations ?? [];
  if (operations.length !== Object.keys(STORYFLOW_CATALOG_OPERATIONS).length) return reject(source);
  for (const operation of operations) {
    const expected = STORYFLOW_CATALOG_OPERATIONS[operation.name];
    if (!expected || operation.method !== expected[0] || operation.path !== expected[1]) {
      return reject(source);
    }
  }

  return { gatewayBaseUrl };
}
