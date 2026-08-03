// input: Pi-native provider lifecycle events and Storyflow provider settings.
// output: Anthropic capability headers, model-call correlation, and HTTP status diagnostics.
// pos: Narrow provider extension below session orchestration and above Pi transports.

import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { isContextOverflow, isRetryableAssistantError } from '@earendil-works/pi-ai/compat';
import type { AssistantMessage, ProviderHeaders } from '@earendil-works/pi-ai';
import { randomUUID } from 'node:crypto';
import { clearLastApiError, setStoredError } from '../../shared/src/provider-diagnostics.ts';

const CONTEXT_1M_BETA = 'context-1m-2025-08-07';

function setAnthropicBeta(headers: ProviderHeaders, beta: string, enabled: boolean): void {
  const key = Object.keys(headers).find(name => name.toLowerCase() === 'anthropic-beta') ?? 'anthropic-beta';
  const values = (headers[key] ?? '').split(',').map(value => value.trim()).filter(Boolean);
  const next = enabled
    ? Array.from(new Set([...values, beta]))
    : values.filter(value => value !== beta);
  headers[key] = next.length > 0 ? next.join(',') : null;
}

export function createProviderHooks(options: { enable1MContext: boolean }): InlineExtension {
  return {
    name: 'storyflow-provider-hooks',
    factory(pi) {
      let activeModelCall: { id: string; attempt: number; status?: number } | undefined;

      pi.on('before_agent_start', () => {
        activeModelCall = undefined;
      });

      pi.on('before_provider_headers', (event, context) => {
        activeModelCall = activeModelCall
          ? { id: activeModelCall.id, attempt: activeModelCall.attempt + 1 }
          : { id: randomUUID(), attempt: 0 };
        event.headers['x-storyflow-model-call-id'] = activeModelCall.id;
        event.headers['x-storyflow-attempt'] = String(activeModelCall.attempt);

        if (context.model?.api !== 'anthropic-messages' || context.model.provider !== 'anthropic') return;
        setAnthropicBeta(event.headers, CONTEXT_1M_BETA, options.enable1MContext);
      });

      pi.on('message_end', (event, context) => {
        if (event.message.role !== 'assistant') return;
        let message = event.message as AssistantMessage;
        const overflow = isContextOverflow(message, context.model?.contextWindow ?? 0);
        if (
          !overflow
          && message.stopReason === 'error'
          && message.errorMessage
          && activeModelCall?.status !== undefined
          && activeModelCall.status >= 500
          && activeModelCall.status < 600
          && !isRetryableAssistantError(message)
        ) {
          // ponytail: remove when Pi classifies every HTTP 5xx instead of a fixed subset.
          message = { ...message, errorMessage: `${message.errorMessage} (server error)` };
        }
        const retryable = !overflow && isRetryableAssistantError(message);
        if (!retryable) activeModelCall = undefined;
        return message === event.message ? undefined : { message };
      });

      pi.on('after_provider_response', (event) => {
        if (activeModelCall) activeModelCall.status = event.status;
        if (event.status < 400) {
          clearLastApiError();
          return;
        }

        const statusText = new Response(null, { status: event.status }).statusText;
        setStoredError({
          status: event.status,
          statusText,
          message: `Provider returned HTTP ${event.status}${statusText ? ` ${statusText}` : ''}`,
          timestamp: Date.now(),
        });
      });
    },
  };
}
