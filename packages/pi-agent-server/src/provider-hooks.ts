// input: Pi-native provider lifecycle events and Storyflow provider settings.
// output: Anthropic headers, stable logical-call correlation, stream diagnostics and managed selection.
// pos: Narrow provider extension below session orchestration and above Pi transports.

import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import type { ProviderHeaders } from '@earendil-works/pi-ai';
import { randomUUID } from 'node:crypto';
import { clearLastApiError, setStoredError } from '../../shared/src/provider-diagnostics.ts';

import { createManagedFallback, type ManagedFallbackOptions } from './managed-fallback.ts';

const CONTEXT_1M_BETA = 'context-1m-2025-08-07';

function setAnthropicBeta(headers: ProviderHeaders, beta: string, enabled: boolean): void {
  const key = Object.keys(headers).find(name => name.toLowerCase() === 'anthropic-beta') ?? 'anthropic-beta';
  const values = (headers[key] ?? '').split(',').map(value => value.trim()).filter(Boolean);
  const next = enabled
    ? Array.from(new Set([...values, beta]))
    : values.filter(value => value !== beta);
  headers[key] = next.length > 0 ? next.join(',') : null;
}

export function createProviderHooks(options: { enable1MContext: boolean; fallback?: ManagedFallbackOptions }): InlineExtension {
  const installFallback = options.fallback ? createManagedFallback(options.fallback) : undefined;
  return {
    name: 'storyflow-provider-hooks',
    factory(pi) {
      let activeModelCall: { id: string; attempt: number; requestedModel?: string; startedAt: number; firstContent: boolean } | undefined;

      let requestedModel: string | undefined;
      const log = options.fallback?.diagnostic;
      pi.on('before_agent_start', (_event, ctx) => {
        requestedModel = ctx.model?.id;
        activeModelCall = undefined;
      });
      installFallback?.(pi);

      pi.on('before_provider_headers', (event, context) => {
        activeModelCall = activeModelCall
          ? { ...activeModelCall, attempt: activeModelCall.attempt + 1, firstContent: false }
          : { id: randomUUID(), attempt: 0, requestedModel: requestedModel ?? context.model?.id, startedAt: Date.now(), firstContent: false };
        event.headers['x-storyflow-model-call-id'] = activeModelCall.id;
        event.headers['x-storyflow-attempt'] = String(activeModelCall.attempt);
        event.headers['x-storyflow-correlation-version'] = '2';
        if (options.fallback?.getConfig()?.managedConnection) event.headers['x-storyflow-error-format'] = 'sdk-v1';
        const retryIndex = options.fallback?.getSession()?.retryAttempt;
        if (retryIndex !== undefined) event.headers['x-storyflow-retry-index'] = String(retryIndex);
        if (activeModelCall.requestedModel) event.headers['x-storyflow-requested-model'] = activeModelCall.requestedModel;
        log?.({ event: 'model_request', model_call_id: activeModelCall.id, attempt: activeModelCall.attempt, retry_index: retryIndex, requested_model: activeModelCall.requestedModel, effective_model: context.model?.id, api: context.model?.api });

        if (context.model?.api !== 'anthropic-messages' || context.model.provider !== 'anthropic') return;
        setAnthropicBeta(event.headers, CONTEXT_1M_BETA, options.enable1MContext);
      });

      pi.on('message_update', event => {
        if (!activeModelCall || activeModelCall.firstContent || !['text_delta', 'thinking_delta', 'toolcall_start'].includes(event.assistantMessageEvent.type)) return;
        activeModelCall.firstContent = true;
        log?.({ event: 'model_first_content', model_call_id: activeModelCall.id, attempt: activeModelCall.attempt, elapsed_ms: Date.now() - activeModelCall.startedAt });
      });
      pi.on('message_end', (event) => {
        if (event.message.role === 'assistant' && activeModelCall) {
          const message = event.message;
          log?.({ event: 'model_stream_end', model_call_id: activeModelCall.id, attempt: activeModelCall.attempt, effective_model: message.model, stop_reason: message.stopReason, outcome: message.stopReason === 'error' ? 'error' : message.stopReason === 'aborted' ? 'aborted' : message.stopReason === 'length' ? 'incomplete' : 'completed', usage: message.usage?.totalTokens > 0 ? { input: message.usage.input, output: message.usage.output, cache_read: message.usage.cacheRead, cache_write: message.usage.cacheWrite } : null, cost: null });
        }
        if (event.message.role === 'assistant' && event.message.stopReason !== 'error') activeModelCall = undefined;
      });

      pi.on('agent_settled', () => { activeModelCall = undefined; });

      pi.on('after_provider_response', (event) => {
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
