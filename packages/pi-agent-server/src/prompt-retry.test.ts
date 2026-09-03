// input: Retryable failures and Pi auto-retry lifecycle events.
// output: Regression coverage for intermediate-versus-final failure visibility.
// pos: Protects the presentation gate around Pi-owned prompt retries.

import { describe, expect, it } from 'bun:test';
import {
  createPromptAttemptState,
  routePromptAttemptEvent,
} from './prompt-retry.ts';

describe('Pi prompt retry presentation', () => {
  it('forwards a non-retryable failure immediately', () => {
    const state = createPromptAttemptState();
    const failure = {
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'error', errorMessage: 'invalid request' },
    } as any;
    expect(routePromptAttemptEvent(failure, state)).toEqual([failure]);
  });

  it('drops a deferred failure only after agent_end confirms a retry', () => {
    const state = createPromptAttemptState();
    const failure = {
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'error', errorMessage: 'HTTP 524' },
    } as any;
    const turnEnd = { type: 'turn_end' } as any;
    const agentEnd = { type: 'agent_end', willRetry: true } as any;

    expect(routePromptAttemptEvent(failure, state)).toEqual([]);
    expect(routePromptAttemptEvent(turnEnd, state)).toEqual([]);
    expect(routePromptAttemptEvent(agentEnd, state)).toEqual([agentEnd]);
  });

  it('restores deferred events when agent_end confirms no retry', () => {
    const state = createPromptAttemptState();
    const failure = {
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'error', errorMessage: 'HTTP 524' },
    } as any;
    const turnEnd = { type: 'turn_end' } as any;
    const agentEnd = { type: 'agent_end', willRetry: false } as any;

    expect(routePromptAttemptEvent(failure, state)).toEqual([]);
    expect(routePromptAttemptEvent(turnEnd, state)).toEqual([]);
    expect(routePromptAttemptEvent(agentEnd, state)).toEqual([failure, turnEnd, agentEnd]);
  });
});
