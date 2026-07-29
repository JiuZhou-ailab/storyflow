// input: Fake Pi Extension API and Storyflow tool callbacks
// output: Regression proof for argument mutation and result replacement
// pos: Focused contract test for Pi-native Storyflow tool hooks

import { describe, expect, test } from 'bun:test';
import type {
  ExtensionAPI,
  ToolCallEvent,
  ToolResultEvent,
} from '@earendil-works/pi-coding-agent';
import { createToolHooks } from './tool-hooks.ts';

describe('createToolHooks', () => {
  test('mutates approved input and returns post-processed results', async () => {
    const handlers = new Map<string, (event: never) => unknown>();
    const extension = createToolHooks({
      async beforeToolCall() {
        return { path: '/approved' };
      },
      async afterToolCall() {
        return { content: [{ type: 'text', text: 'summarized' }] };
      },
    });
    const factory = typeof extension === 'function' ? extension : extension.factory;
    await factory({
      on(event, handler) {
        handlers.set(event, handler as (event: never) => unknown);
      },
    } as ExtensionAPI);

    const callEvent = {
      type: 'tool_call',
      toolName: 'read',
      toolCallId: 'call-1',
      input: { path: '/original', _intent: 'inspect' },
    } as ToolCallEvent;
    await handlers.get('tool_call')!(callEvent as never);
    expect(callEvent.input).toEqual({ path: '/approved' });

    const result = await handlers.get('tool_result')!({
      type: 'tool_result',
      toolName: 'read',
      toolCallId: 'call-1',
      input: callEvent.input,
      content: [{ type: 'text', text: 'large' }],
      details: undefined,
      isError: false,
    } as ToolResultEvent as never);
    expect(result).toEqual({ content: [{ type: 'text', text: 'summarized' }] });
  });
});
