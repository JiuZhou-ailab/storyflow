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

  test('correlates Pi retries without grouping the next model call', async () => {
    const handlers = new Map<string, (event: never, context: never) => unknown>();
    const extension = createProviderHooks({ enable1MContext: false });
    const factory = typeof extension === 'function' ? extension : extension.factory;
    await factory({
      on(event, handler) {
        handlers.set(event, handler as (event: never, context: never) => unknown);
      },
    } as ExtensionAPI);

    await handlers.get('before_agent_start')!({ type: 'before_agent_start' } as never, {} as never);
    const firstHeaders = {};
    await handlers.get('before_provider_headers')!(
      { type: 'before_provider_headers', headers: firstHeaders } as never,
      { model: { api: 'openai-responses', provider: 'custom-endpoint' } } as never,
    );
    await handlers.get('after_provider_response')!(
      { type: 'after_provider_response', status: 520, headers: {} } as never,
      {} as never,
    );
    const normalized = await handlers.get('message_end')!(
      {
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'error', errorMessage: '520 error code: 520' },
      } as never,
      { model: { contextWindow: 128_000 } } as never,
    );
    expect(normalized).toMatchObject({
      message: { errorMessage: '520 error code: 520 (server error)' },
    });

    const retryHeaders = {};
    await handlers.get('before_provider_headers')!(
      { type: 'before_provider_headers', headers: retryHeaders } as never,
      { model: { api: 'openai-responses', provider: 'custom-endpoint' } } as never,
    );
    expect(retryHeaders['x-storyflow-model-call-id']).toBe(firstHeaders['x-storyflow-model-call-id']);
    expect(firstHeaders['x-storyflow-attempt']).toBe('0');
    expect(retryHeaders['x-storyflow-attempt']).toBe('1');

    await handlers.get('message_end')!(
      { type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } } as never,
      { model: {} } as never,
    );
    const nextHeaders = {};
    await handlers.get('before_provider_headers')!(
      { type: 'before_provider_headers', headers: nextHeaders } as never,
      { model: { api: 'openai-responses', provider: 'custom-endpoint' } } as never,
    );
    expect(nextHeaders['x-storyflow-model-call-id']).not.toBe(firstHeaders['x-storyflow-model-call-id']);
    expect(nextHeaders['x-storyflow-attempt']).toBe('0');

    const nonHttpError = await handlers.get('message_end')!(
      {
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'error', errorMessage: 'max_tokens must be <= 512' },
      } as never,
      { model: { contextWindow: 128_000 } } as never,
    );
    expect(nonHttpError).toBeUndefined();
  });
});
