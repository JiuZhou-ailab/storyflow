// input: Real Pi SDKs, gateway access failures and desktop error projection.
// output: Cross-protocol rejection, diagnosis and provider retry regression coverage.
// pos: HTTP-to-runtime contract shared by issues #41 and #42.
import { expect, test } from 'bun:test';
import { accessFailure } from '../../shared/src/auth/managed-access.ts';
import { parseError } from '../../shared/src/agent/errors.ts';
import { normalizeManagedDefaultGatewayAuthError } from '../../server-core/src/sessions/managed-gateway-auth-error.ts';
import { fixture, protocolCompletion } from './managed-fallback.fixture.ts';
import { cloneManagedModelCatalog } from '../../shared/src/config/managed-model-catalog.ts';
import { normalizeUpstreamError } from '../../../apps/model-gateway-worker/src/upstream-error.ts';

const protocols = [
  ['openai-completions', ['deepseek-v4-flash', 'deepseek-v4-pro']],
  ['openai-responses', ['gpt-5.6-sol', 'gpt-5.5']],
  ['anthropic-messages', ['claude-sonnet-5', 'claude-opus-5']],
  ['google-generative-ai', ['gemini-3.8-flash', 'gemini-3.7-flash']],
] as const;

for (const [api, models] of protocols) {
  test(`${api} product catalog qualifies A,A,B with each model's native output capacity`, async () => {
    await fixture(async ({ session, requests }) => {
      await session.prompt('test');
      await session.waitForIdle();
      expect(requests.map(request => request.model)).toEqual([models[0], models[0], models[1]]);
      expect(session.getLastAssistantText()).toBe('OK');
      expect(session.model?.maxTokens).toBe(cloneManagedModelCatalog(api).find(model => model.id === session.model?.id)!.fallbackCapabilities!.maxOutputTokens);
      for (const { body, model } of requests) {
        const budget = body.max_tokens ?? body.max_completion_tokens ?? body.max_output_tokens
          ?? (body.generationConfig as { maxOutputTokens?: number } | undefined)?.maxOutputTokens;
        expect(budget).toBe(cloneManagedModelCatalog(api).find(entry => entry.id === model)!.fallbackCapabilities!.maxOutputTokens);
      }
    }, (model, index) => index < 3 ? Response.json({ error: { message: '503 unavailable' } }, { status: 503 })
      : protocolCompletion(api, model), undefined,
    { api, models: [...models], catalog: cloneManagedModelCatalog(api).filter(model => models.includes(model.id as never)) });
  });
  for (const reason of ['session_revoked', 'account_disabled', 'scope_denied', 'dependency_unavailable'] as const) {
    test(`${api} preserves ${reason} through the actual SDK and UI projection`, async () => {
      await fixture(async ({ session, requests, notices }) => {
        await session.prompt('test');
        await session.waitForIdle();
        expect(requests).toHaveLength(1);
        expect(notices).toHaveLength(0);
        const message = session.messages.at(-1)!;
        expect(message.role).toBe('assistant');
        if (message.role !== 'assistant') throw new Error('Missing assistant failure');
        const projected = normalizeManagedDefaultGatewayAuthError(
          parseError(new Error(message.errorMessage)), 'storyflow-managed',
        );
        expect(JSON.parse(projected.originalError!)).toEqual({
          code: reason === 'dependency_unavailable' ? 'authorization_dependency_unavailable'
            : reason === 'session_revoked' ? 'model_access_token_invalid' : 'managed_access_denied',
          reason, stage: 'model', correlation_id: 'contract-42',
        });
        expect(projected.canRetry).toBe(reason === 'dependency_unavailable');
        expect(projected.title).toBe(reason === 'session_revoked' ? 'Sign In Required'
          : reason === 'dependency_unavailable' ? 'Default AI Access Interrupted' : 'Default AI Access Denied');
      }, (_model, _index, _body, headers) => accessFailure(reason, 'model', {
        correlation_id: 'contract-42',
      }, headers.get('x-storyflow-error-format') === 'sdk-v1' ? 'sdk' : 'legacy'), undefined,
      { api, models: [...models], maxRetries: 0, providerRetries: reason === 'dependency_unavailable' ? 0 : 1 });
    });
  }
  test(`${api} provider retry respects permanent gateway rejection`, async () => {
    await fixture(async ({ session, requests }) => {
      await session.prompt('test');
      await session.waitForIdle();
      expect(requests).toHaveLength(1);
    }, () => Response.json({ error: 'Upstream access denied', code: 'upstream_auth_failed', retryable: false },
      { status: 502, headers: { 'x-should-retry': 'false' } }), undefined,
    { api, models: [...models], providerRetries: 1 });
  });
}

test('Google provider retry honors bounded body Retry-After when its SDK drops headers', async () => {
  await fixture(async ({ session, requests }) => {
    await session.prompt('test');
    await session.waitForIdle();
    expect(requests).toHaveLength(2);
    expect(requests[1]!.at - requests[0]!.at).toBeGreaterThanOrEqual(990);
  }, (model, index) => index === 1
    ? Response.json({ error: { message: '503 unavailable', retryable: true, retry_after_ms: 1000 } },
      { status: 503, headers: { 'retry-after': '1' } })
    : protocolCompletion('google-generative-ai', model), undefined,
  { api: 'google-generative-ai', models: ['gemini-3.8-flash', 'gemini-3.7-flash'], providerRetries: 1 });
});

test('Google preserves permanent semantics after the gateway adds metadata to a near-limit body', async () => {
  await fixture(async ({ session, requests }) => {
    await session.prompt('test');
    await session.waitForIdle();
    expect(requests).toHaveLength(1);
  }, async () => (await normalizeUpstreamError(Response.json({
    error: { message: 'Invalid request', code: 'invalid_request_error', padding: 'x'.repeat(16_250) },
  }, { status: 502 }))).response, undefined,
  { api: 'google-generative-ai', models: ['gemini-3.8-flash', 'gemini-3.7-flash'], providerRetries: 1 });
});

test('legacy clients retain the published string error shape', async () => {
  const response = await accessFailure('account_disabled', 'model').json();
  expect(response.error).toBe('Managed access permission denied');
  expect(response.reason).toBe('account_disabled');
});
