// input: Concurrent Pi CredentialStore updates
// output: Regression checks for serialized refresh and immediate product notification
// pos: Guards the OAuth refresh ownership boundary required by ADR 0018

import { expect, it } from 'bun:test';
import { ProductCredentialStore } from './product-auth-storage.ts';

it('serializes async refreshes and reports each committed credential update', async () => {
  const updates: string[] = [];
  const store = await ProductCredentialStore.create({}, (_providerId, credential) => {
    if (credential?.type === 'api_key') updates.push(credential.key ?? '');
  });
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const order: string[] = [];

  const first = store.modify('anthropic', async () => {
    order.push('first:start');
    await firstGate;
    order.push('first:end');
    return { type: 'api_key', key: 'version-1' };
  });
  const second = store.modify('anthropic', async current => {
    order.push(`second:${current?.type === 'api_key' ? current.key : 'missing'}`);
    return { type: 'api_key', key: 'version-2' };
  });

  releaseFirst();
  await Promise.all([first, second]);
  expect(order).toEqual(['first:start', 'first:end', 'second:version-1']);
  expect(updates).toEqual(['version-1', 'version-2']);
});
