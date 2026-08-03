// input: Fake Pi provider events and model context.
// output: Regression proof for native provider header and status hooks.
// pos: Contract test for Storyflow's Pi-native provider extensions.

import { describe, expect, test } from 'bun:test';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createProviderHooks } from './provider-hooks.ts';

describe('createProviderHooks', () => {
  test('owns the 1M Anthropic beta header without touching other providers', async () => {
    const handlers = new Map<string, (event: never, context: never) => unknown>();
    const extension = createProviderHooks({ enable1MContext: false });
    const factory = typeof extension === 'function' ? extension : extension.factory;
    await factory({
      on(event, handler) {
        handlers.set(event, handler as (event: never, context: never) => unknown);
      },
    } as ExtensionAPI);

    const anthropicHeaders = {
      'anthropic-beta': 'fine-grained-tool-streaming-2025-05-14,context-1m-2025-08-07',
    };
    await handlers.get('before_provider_headers')!(
      { type: 'before_provider_headers', headers: anthropicHeaders } as never,
      { model: { api: 'anthropic-messages', provider: 'anthropic' } } as never,
    );
    expect(anthropicHeaders['anthropic-beta']).toBe('fine-grained-tool-streaming-2025-05-14');

    const customHeaders = { 'anthropic-beta': 'context-1m-2025-08-07' };
    await handlers.get('before_provider_headers')!(
      { type: 'before_provider_headers', headers: customHeaders } as never,
      { model: { api: 'anthropic-messages', provider: 'custom-endpoint' } } as never,
    );
    expect(customHeaders['anthropic-beta']).toBe('context-1m-2025-08-07');
  });

  test('adds the 1M beta only for the official Anthropic provider', async () => {
    const handlers = new Map<string, (event: never, context: never) => unknown>();
    const extension = createProviderHooks({ enable1MContext: true });
    const factory = typeof extension === 'function' ? extension : extension.factory;
    await factory({
      on(event, handler) {
        handlers.set(event, handler as (event: never, context: never) => unknown);
      },
    } as ExtensionAPI);

    const headers = { 'anthropic-beta': 'existing-beta' };
    await handlers.get('before_provider_headers')!(
      { type: 'before_provider_headers', headers } as never,
      { model: { api: 'anthropic-messages', provider: 'anthropic' } } as never,
    );
    expect(headers['anthropic-beta']).toBe('existing-beta,context-1m-2025-08-07');
  });
});
