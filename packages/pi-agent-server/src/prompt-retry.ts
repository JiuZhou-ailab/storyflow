// input: Pi prompt errors and lightweight AgentSessionEvent snapshots.
// output: Side-effect-aware retry decisions for transient provider stream failures.
// pos: Keeps prompt retry policy explicit and testable outside the Pi SDK runtime.

export interface PromptAttemptState {
  hasAssistantOutput: boolean;
  hasToolActivity: boolean;
  retryAttempted: boolean;
  suppressedRetryableFailure: boolean;
}

export function createPromptAttemptState(): PromptAttemptState {
  return {
    hasAssistantOutput: false,
    hasToolActivity: false,
    retryAttempted: false,
    suppressedRetryableFailure: false,
  };
}

export function isAnthropicMessageStopStreamError(message: unknown): boolean {
  return typeof message === 'string' && /anthropic stream ended before message_stop/i.test(message);
}

export function shouldAutoRetryPromptFailure(message: unknown, state: PromptAttemptState): boolean {
  return (
    isAnthropicMessageStopStreamError(message) &&
    !state.retryAttempted &&
    !state.hasAssistantOutput &&
    !state.hasToolActivity
  );
}

export function recordPromptAttemptEvent(state: PromptAttemptState, event: Record<string, unknown>): void {
  if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end') {
    state.hasToolActivity = true;
    return;
  }

  if (event.type === 'message_update') {
    const assistantMessageEvent = event.assistantMessageEvent as { type?: string; delta?: unknown } | undefined;
    if (
      assistantMessageEvent?.type === 'text_delta' &&
      typeof assistantMessageEvent.delta === 'string' &&
      assistantMessageEvent.delta.length > 0
    ) {
      state.hasAssistantOutput = true;
    }
    return;
  }

  if (event.type !== 'message_end') return;

  const message = event.message as { role?: string; content?: unknown } | undefined;
  if (message?.role !== 'assistant' || !Array.isArray(message.content)) return;

  for (const block of message.content as Array<{ type?: string; text?: unknown }>) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
      state.hasAssistantOutput = true;
    }
    if (block.type === 'toolCall' || block.type === 'tool_use') {
      state.hasToolActivity = true;
    }
  }
}
