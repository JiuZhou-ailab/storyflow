// input: Pending OAuth flows shared by start, complete, cancel, and revoke
// output: Regression coverage for single-use claims and exact Source invalidation
// pos: Guards the in-memory OAuth authorization-code capability boundary

import { afterEach, describe, expect, it } from 'bun:test';
import { OAuthFlowStore, createPendingFlow } from './oauth-flow-store.ts';
import type { PendingOAuthFlow } from './oauth-flow-store.ts';

const stores: OAuthFlowStore[] = [];

function flow(state: string, workspaceId = 'project-1', sourceSlug = 'source-1'): PendingOAuthFlow {
  return createPendingFlow({
    flowId: `flow-${state}`,
    state,
    codeVerifier: 'verifier',
    redirectUri: 'http://localhost/callback',
    source: {} as PendingOAuthFlow['source'],
    clientId: 'oauth-client',
    tokenEndpoint: 'https://example.test/token',
    provider: 'generic',
    ownerClientId: 'rpc-client',
    workspaceId,
    sourceSlug,
  });
}

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
});

describe('OAuthFlowStore authorization capability', () => {
  it('allows a pending flow to be claimed only once', () => {
    const store = new OAuthFlowStore();
    stores.push(store);
    const pending = flow('state-1');
    store.store(pending);

    expect(store.claim('state-1')).toBe(pending);
    expect(store.claim('state-1')).toBeNull();
  });

  it('invalidates only flows owned by the revoked Source', () => {
    const store = new OAuthFlowStore();
    stores.push(store);
    store.store(flow('revoked-1'));
    store.store(flow('revoked-2'));
    store.store(flow('other-source', 'project-1', 'source-2'));
    store.store(flow('other-project', 'project-2', 'source-1'));

    store.removeForSource('project-1', 'source-1');

    expect(store.getByState('revoked-1')).toBeNull();
    expect(store.getByState('revoked-2')).toBeNull();
    expect(store.getByState('other-source')).not.toBeNull();
    expect(store.getByState('other-project')).not.toBeNull();
  });
});
