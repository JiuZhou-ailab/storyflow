// input: Concurrent Pi AuthStorage backend updates
// output: Regression checks for serialized refresh and immediate product notification
// pos: Guards the OAuth refresh ownership boundary required by ADR 0018

import { expect, it } from 'bun:test';
import { ProductAuthStorageBackend } from './product-auth-storage.ts';

it('serializes async refreshes and reports each committed credential update', async () => {
  const updates: string[] = [];
  const backend = new ProductAuthStorageBackend('{}', next => updates.push(next));
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const order: string[] = [];

  const first = backend.withLockAsync(async () => {
    order.push('first:start');
    await firstGate;
    order.push('first:end');
    return { result: 1, next: '{"version":1}' };
  });
  const second = backend.withLockAsync(async current => {
    order.push(`second:${current}`);
    return { result: 2, next: '{"version":2}' };
  });

  expect(() => backend.withLock(() => ({ result: 0 }))).toThrow('OAuth refresh is active');
  releaseFirst();
  expect(await Promise.all([first, second])).toEqual([1, 2]);
  expect(order).toEqual(['first:start', 'first:end', 'second:{"version":1}']);
  expect(updates).toEqual(['{"version":1}', '{"version":2}']);
});
