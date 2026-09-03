// input: Pi retryable prompt errors and auto-retry lifecycle events.
// output: Decisions for hiding intermediate failures while Pi owns retry execution.
// pos: Presentation gate between Pi's retry state machine and Storyflow events.

import { isRetryableAssistantError } from '@earendil-works/pi-ai/compat';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

export interface PromptAttemptState {
  deferredEvents: AgentSessionEvent[];
}

export function createPromptAttemptState(): PromptAttemptState {
  return {
    deferredEvents: [],
  };
}

function isRetryableFailure(event: AgentSessionEvent): boolean {
  if (event.type !== 'message_end') return false;
  const message = event.message as AssistantMessage;
  return isRetryableAssistantError({
    stopReason: message.stopReason,
    errorMessage: message.errorMessage,
  } as AssistantMessage);
}

export function routePromptAttemptEvent(
  event: AgentSessionEvent,
  state: PromptAttemptState,
): AgentSessionEvent[] {
  if (state.deferredEvents.length > 0) {
    if (event.type === 'agent_end') {
      const deferredEvents = state.deferredEvents;
      state.deferredEvents = [];
      return event.willRetry ? [event] : [...deferredEvents, event];
    }
    state.deferredEvents.push(event);
    return [];
  }

  if (!isRetryableFailure(event)) return [event];
  state.deferredEvents.push(event);
  return [];
}
