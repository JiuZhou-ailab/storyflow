// input: Prompt failures and per-attempt Pi session event snapshots.
// output: Regression coverage for safe prompt retry decisions.
// pos: Protects Pi prompt retry policy from unsafe duplicate side effects.

import { describe, expect, it } from 'bun:test';
import {
  createPromptAttemptState,
  isAnthropicMessageStopStreamError,
  recordPromptAttemptEvent,
  shouldAutoRetryPromptFailure,
} from './prompt-retry.ts';

describe('Pi prompt retry policy', () => {
  it('recognizes Anthropic message_stop stream truncation errors', () => {
    expect(isAnthropicMessageStopStreamError('Anthropic stream ended before message_stop')).toBe(true);
    expect(isAnthropicMessageStopStreamError('API Error: 503 overloaded_error')).toBe(false);
  });

  it('allows one automatic retry before any assistant output or tool activity', () => {
    const state = createPromptAttemptState();

    expect(shouldAutoRetryPromptFailure('Anthropic stream ended before message_stop', state)).toBe(true);
  });

  it('blocks automatic retry after visible assistant output', () => {
    const state = createPromptAttemptState();
    recordPromptAttemptEvent(state, {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
    });

    expect(shouldAutoRetryPromptFailure('Anthropic stream ended before message_stop', state)).toBe(false);
  });

  it('blocks automatic retry after tool activity', () => {
    const state = createPromptAttemptState();
    recordPromptAttemptEvent(state, {
      type: 'tool_execution_start',
      toolName: 'write',
      toolCallId: 'call_1',
      args: { path: 'setup-plan.md' },
    });

    expect(shouldAutoRetryPromptFailure('Anthropic stream ended before message_stop', state)).toBe(false);
  });

  it('blocks repeated automatic retries for the same prompt', () => {
    const state = createPromptAttemptState();
    state.retryAttempted = true;

    expect(shouldAutoRetryPromptFailure('Anthropic stream ended before message_stop', state)).toBe(false);
  });
});
