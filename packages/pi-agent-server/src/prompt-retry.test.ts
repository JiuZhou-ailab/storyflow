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

  const encryptedFailure = () => ({
    type: 'message_end',
    message: {
      role: 'assistant',
      api: 'openai-responses',
      stopReason: 'error',
      errorMessage: 'custom-endpoint API error (400): {"message":"bad","code":"invalid_encrypted_content","retryable":false}',
    },
  }) as any;

  it('drops an encrypted-reasoning failure once the recovery run starts', () => {
    const state = createPromptAttemptState();
    const failure = encryptedFailure();
    const agentEnd = { type: 'agent_end', willRetry: false } as any;
    const agentStart = { type: 'agent_start' } as any;

    expect(routePromptAttemptEvent(failure, state)).toEqual([]);
    expect(routePromptAttemptEvent(agentEnd, state)).toEqual([]);
    expect(routePromptAttemptEvent(agentStart, state)).toEqual([agentStart]);
    const second = encryptedFailure();
    expect(routePromptAttemptEvent(second, state)).toEqual([second]);
  });

  it('restores an encrypted-reasoning failure when the run settles without recovery', () => {
    const state = createPromptAttemptState();
    const failure = encryptedFailure();
    const agentEnd = { type: 'agent_end', willRetry: false } as any;
    const settled = { type: 'agent_settled' } as any;

    expect(routePromptAttemptEvent(failure, state)).toEqual([]);
    expect(routePromptAttemptEvent(agentEnd, state)).toEqual([]);
    expect(routePromptAttemptEvent(settled, state)).toEqual([failure, agentEnd, settled]);
  });
});
