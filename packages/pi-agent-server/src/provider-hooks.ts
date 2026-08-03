// input: Pi-native provider lifecycle events and Storyflow provider settings.
// output: Anthropic capability headers and session-scoped HTTP error status diagnostics.
// pos: Narrow provider extension below session orchestration and above Pi transports.

import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import type { ProviderHeaders } from '@earendil-works/pi-ai';
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
      pi.on('before_provider_headers', (event, context) => {
        if (context.model?.api !== 'anthropic-messages' || context.model.provider !== 'anthropic') return;
        setAnthropicBeta(event.headers, CONTEXT_1M_BETA, options.enable1MContext);
      });

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
