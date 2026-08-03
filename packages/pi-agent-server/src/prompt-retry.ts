// input: Pi retryable prompt errors and auto-retry lifecycle events.
// output: Decisions for hiding intermediate failures while Pi owns retry execution.
// pos: Presentation gate between Pi's retry state machine and Storyflow events.

import { isRetryableAssistantError } from '@earendil-works/pi-ai/compat';
import type { AssistantMessage } from '@earendil-works/pi-ai';

export interface PromptAttemptState {
  canRetry: boolean;
  suppressedRetryableFailure: boolean;
}

export function createPromptAttemptState(): PromptAttemptState {
  return {
    canRetry: true,
    suppressedRetryableFailure: false,
  };
}

export function shouldSuppressRetryablePromptFailure(
  message: unknown,
  state: PromptAttemptState,
): boolean {
  if (typeof message !== 'string' || !state.canRetry) return false;
  return isRetryableAssistantError({
    stopReason: 'error',
    errorMessage: message,
  } as AssistantMessage);
}

export function shouldSuppressRetryingAgentEnd(
  event: Record<string, unknown>,
  state: PromptAttemptState,
): boolean {
  return event.type === 'agent_end'
    && event.willRetry === true
    && state.suppressedRetryableFailure;
}

export function recordPromptAttemptEvent(state: PromptAttemptState, event: Record<string, unknown>): void {
  if (event.type === 'auto_retry_start') {
    const attempt = typeof event.attempt === 'number' ? event.attempt : 0;
    const maxAttempts = typeof event.maxAttempts === 'number' ? event.maxAttempts : 0;
    state.canRetry = attempt < maxAttempts;
    state.suppressedRetryableFailure = false;
  } else if (event.type === 'auto_retry_end') {
    state.canRetry = false;
    state.suppressedRetryableFailure = false;
  }
}
