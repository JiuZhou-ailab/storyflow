// input: Retryable failures and Pi auto-retry lifecycle events.
// output: Regression coverage for intermediate-versus-final failure visibility.
// pos: Protects the presentation gate around Pi-owned prompt retries.

import { describe, expect, it } from 'bun:test';
import {
  createPromptAttemptState,
  recordPromptAttemptEvent,
  shouldSuppressRetryingAgentEnd,
  shouldSuppressRetryablePromptFailure,
} from './prompt-retry.ts';

describe('Pi prompt retry presentation', () => {
  it('suppresses a retryable failure while Pi still has budget', () => {
    const state = createPromptAttemptState();
    expect(shouldSuppressRetryablePromptFailure('HTTP 524', state)).toBe(true);
    expect(shouldSuppressRetryablePromptFailure('400 response_format is unavailable', state)).toBe(false);
  });

  it('exposes the final failed attempt and its terminal agent_end', () => {
    const state = createPromptAttemptState();
    state.suppressedRetryableFailure = true;
    expect(shouldSuppressRetryingAgentEnd({ type: 'agent_end', willRetry: true }, state)).toBe(true);
    recordPromptAttemptEvent(state, {
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 1,
    });
    expect(shouldSuppressRetryablePromptFailure('HTTP 524', state)).toBe(false);
    expect(shouldSuppressRetryingAgentEnd({ type: 'agent_end', willRetry: false }, state)).toBe(false);
    recordPromptAttemptEvent(state, { type: 'auto_retry_end', success: false });
    expect(shouldSuppressRetryablePromptFailure('HTTP 524', state)).toBe(false);
  });

  it('continues suppressing while additional Pi retries remain', () => {
    const state = createPromptAttemptState();
    state.suppressedRetryableFailure = true;
    recordPromptAttemptEvent(state, {
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 3,
    });
    expect(state.suppressedRetryableFailure).toBe(false);
    expect(shouldSuppressRetryablePromptFailure('network error', state)).toBe(true);
  });
});
