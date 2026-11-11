// input: Pi assistant failures, settle boundaries and per-request context projection
// output: One bounded resend after `invalid_encrypted_content`, replaying earlier Responses history as cross-model history
// pos: Pi-extension compensation for upstream account pools without session stickiness (spec #62)
//
// Temporary: remove once the managed upstream guarantees account stickiness, or
// Pi/pi-ai recovers from invalid encrypted reasoning natively. Persisted history
// is never rewritten; the failed attempt is omitted with an append-only context edit.

import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const CODE = 'invalid_encrypted_content';
const RESPONSES_APIS = new Set(['openai-responses', 'azure-openai-responses', 'openai-codex-responses']);
// A different model id makes pi-ai apply its cross-model replay rules: reasoning
// items and paired function_call item ids are not replayed; text and tools are.
const REPLAY_RESET_SUFFIX = '#storyflow-reasoning-reset';

/** Structured provider/gateway code only; message wording is not evidence. */
export function isEncryptedReasoningFailure(message: { role: string } & Partial<AssistantMessage>): boolean {
  if (message.role !== 'assistant' || message.stopReason !== 'error' || !RESPONSES_APIS.has(message.api ?? '')) return false;
  const text = message.errorMessage ?? '';
  const start = text.indexOf('{');
  if (start < 0) return false;
  try {
    const body = JSON.parse(text.slice(start)) as Record<string, unknown>;
    const error = body.error && typeof body.error === 'object' ? body.error as Record<string, unknown> : undefined;
    return body.code === CODE || error?.code === CODE;
  } catch {
    return false;
  }
}

export function installEncryptedReasoningRecovery(pi: ExtensionAPI, options: { diagnostic?(data: Record<string, unknown>): void } = {}): void {
  // Runtime-local by design: a restart forgets the cutoff and costs at most one more recovery.
  const cutoffs = new Map<string, number>();
  let recovered = false;
  let resending = false;
  let failure: AssistantMessage | undefined;
  pi.on('before_agent_start', () => {
    recovered = false;
    resending = false;
    failure = undefined;
  });
  pi.on('message_end', (event) => {
    if (event.message.role !== 'assistant') return;
    failure = isEncryptedReasoningFailure(event.message) ? event.message : undefined;
    if (!resending || event.message.stopReason === 'error' || event.message.stopReason === 'aborted') return;
    resending = false;
    options.diagnostic?.({ event: 'encrypted_reasoning_recovery', model: event.message.model, result: 'recovered' });
  });
  pi.on('agent_before_settle', (event, ctx) => {
    const current = failure;
    failure = undefined;
    if (!current) return;
    if (recovered || event.outcome !== 'error' || ctx.signal?.aborted) {
      if (resending) options.diagnostic?.({ event: 'encrypted_reasoning_recovery', model: current.model, result: 'failed' });
      resending = false;
      return;
    }
    const target = [...ctx.sessionManager.getBranch()].reverse().find(entry =>
      entry.type === 'message' && entry.message.role === 'assistant' && entry.message.timestamp === current.timestamp);
    if (!target) return;
    const sessionId = ctx.sessionManager.getSessionId();
    cutoffs.set(sessionId, Math.max(cutoffs.get(sessionId) ?? 0, current.timestamp));
    recovered = true;
    resending = true;
    options.diagnostic?.({ event: 'encrypted_reasoning_recovery', model: current.model, result: 'resend' });
    return { entries: [{ type: 'context_edit', targetId: target.id, replacement: null }], continue: true };
  });
  pi.on('context', (event, ctx) => {
    const cutoff = cutoffs.get(ctx.sessionManager.getSessionId());
    if (cutoff === undefined) return undefined;
    let changed = false;
    const messages = event.messages.map(message => {
      if (message.role !== 'assistant' || !RESPONSES_APIS.has(message.api) || message.timestamp > cutoff) return message;
      changed = true;
      return { ...message, model: `${message.model}${REPLAY_RESET_SUFFIX}` };
    });
    return changed ? { messages } : undefined;
  });
}
