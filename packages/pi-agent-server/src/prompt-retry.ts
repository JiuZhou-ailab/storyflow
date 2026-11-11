// input: Pi retryable prompt errors, encrypted-reasoning recovery continuations and lifecycle events.
// output: Decisions for hiding intermediate failures while Pi or a Pi extension owns the resend.
// pos: Presentation gate between Pi's retry state machine and Storyflow events.

import { isRetryableAssistantError } from '@earendil-works/pi-ai/compat';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { isEncryptedReasoningFailure } from './encrypted-reasoning-recovery.ts';

export interface PromptAttemptState {
  deferredEvents: AgentSessionEvent[];
  /** Set while an encrypted-reasoning failure waits for the recovery continuation or settlement. */
  awaitingRecovery: boolean;
  /** Bounds deferral to one encrypted-reasoning failure per prompt; pending until its agent_end. */
  recovery: 'none' | 'pending' | 'used';
}

export function createPromptAttemptState(): PromptAttemptState {
  return {
    deferredEvents: [],
    awaitingRecovery: false,
    recovery: 'none',
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
  if (state.awaitingRecovery) {
    // The recovery extension resends via a new agent run; settlement means it declined or was aborted.
    if (event.type !== 'agent_start' && event.type !== 'agent_settled') {
      state.deferredEvents.push(event);
      return [];
    }
    const deferredEvents = state.deferredEvents;
    state.deferredEvents = [];
    state.awaitingRecovery = false;
    return event.type === 'agent_start' ? [event] : [...deferredEvents, event];
  }

  if (state.deferredEvents.length > 0) {
    if (event.type === 'agent_end' && state.recovery === 'pending') {
      state.recovery = 'used';
      state.deferredEvents.push(event);
      state.awaitingRecovery = true;
      return [];
    }
    if (event.type === 'agent_end') {
      const deferredEvents = state.deferredEvents;
      state.deferredEvents = [];
      return event.willRetry ? [event] : [...deferredEvents, event];
    }
    state.deferredEvents.push(event);
    return [];
  }

  if (isRetryableFailure(event)) {
    state.deferredEvents.push(event);
    return [];
  }
  // At most one recovery per prompt, matching the extension's own bound.
  if (event.type === 'message_end' && state.recovery === 'none'
    && event.message.role === 'assistant' && isEncryptedReasoningFailure(event.message)) {
    state.recovery = 'pending';
    state.deferredEvents.push(event);
    return [];
  }
  return [event];
}
