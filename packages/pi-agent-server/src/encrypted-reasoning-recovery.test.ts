// input: Real Pi sessions over the loopback Responses fixture provider.
// output: Request-count, request-body and history contracts for encrypted-reasoning recovery (spec #62).
// pos: Pi-session seam for the recovery extension; the gateway seam lives in model-gateway-worker.

import { expect, test } from 'bun:test';
import { Type } from 'typebox';
import { defineTool, type InlineExtension } from '@earendil-works/pi-coding-agent';
import { fixture } from './managed-fallback.fixture.ts';
import { isEncryptedReasoningFailure } from './encrypted-reasoning-recovery.ts';

const CIPHER = 'CIPHER-FROM-ACCOUNT-A';

function sse(events: object[]): Response {
  return new Response(
    events.map(event => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

/** One Responses turn: an encrypted reasoning item, then either a tool call or a text answer. */
function responsesTurn(model: string, output: { cipher?: string; text?: string; call?: { id: string; name: string } }): Response {
  const items: object[] = [];
  if (output.cipher) items.push({ type: 'reasoning', id: 'rs_fixture', summary: [], encrypted_content: output.cipher });
  if (output.call) items.push({ type: 'function_call', id: 'fc_fixture', call_id: output.call.id, name: output.call.name, arguments: '{}', status: 'completed' });
  if (output.text) items.push({ type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: output.text, annotations: [] }] });
  return sse([
    { type: 'response.created', response: { id: 'fixture', status: 'in_progress' } },
    ...items.flatMap((item, index) => [
      { type: 'response.output_item.added', output_index: index, item },
      { type: 'response.output_item.done', output_index: index, item },
    ]),
    {
      type: 'response.completed',
      response: {
        id: 'fixture', status: 'completed', model, output: items,
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
      },
    },
  ]);
}

// Managed gateway shape; the OpenAI SDK unwraps `error` into the message pi-ai formats.
const invalidEncrypted = () => Response.json(
  { error: { message: 'The encrypted conversation context could not be validated', code: 'invalid_encrypted_content', upstream_status: 400, scope: 'upstream_request', retryable: false } },
  { status: 400, headers: { 'x-should-retry': 'false' } },
);

test('detects only structured Responses invalid_encrypted_content failures', () => {
  const failure = (api: string, errorMessage: string) => ({ role: 'assistant', api, stopReason: 'error', errorMessage }) as const;
  expect(isEncryptedReasoningFailure(failure('openai-responses', 'fixture API error (400): {"code":"invalid_encrypted_content"}'))).toBe(true);
  expect(isEncryptedReasoningFailure(failure('azure-openai-responses', 'Azure OpenAI API error (400): {"error":{"code":"invalid_encrypted_content"}}'))).toBe(true);
  expect(isEncryptedReasoningFailure(failure('openai-responses', 'fixture API error (400): invalid_encrypted_content'))).toBe(false);
  expect(isEncryptedReasoningFailure(failure('openai-completions', 'fixture API error (400): {"code":"invalid_encrypted_content"}'))).toBe(false);
});

test('an encrypted-reasoning rejection resends once without the stale reasoning and keeps the rest of the history', async () => {
  let rotated = false;
  let toolExecutions = 0;
  const lookup = defineTool({
    name: 'lookup',
    label: 'lookup',
    description: 'Fixture lookup',
    parameters: Type.Object({}),
    execute: async () => {
      toolExecutions++;
      return { content: [{ type: 'text', text: 'LOOKUP RESULT' }], details: {} };
    },
  });
  await fixture(async f => {
    // Turn 1 on account A: reasoning + tool call, then a final answer.
    await f.session.prompt('Find the chapter');
    await f.session.waitForIdle();
    expect(f.session.getLastAssistantText()).toBe('FOUND');
    expect(toolExecutions).toBe(1);
    const historyBefore = structuredClone(f.session.sessionManager.getEntries());

    // The pool moves the session to account B, which rejects A's ciphertext.
    rotated = true;
    const shownEvents: string[] = [];
    const unsubscribe = f.session.subscribe(event => {
      if (event.type === 'message_end' && event.message.role === 'assistant' && event.message.stopReason === 'error') shownEvents.push(event.message.errorMessage ?? '');
    });
    const before = f.requests.length;
    await f.session.prompt('Continue writing');
    await f.session.waitForIdle();
    unsubscribe();
    expect(f.requests.length - before).toBe(2);
    const [rejected, resent] = f.requests.slice(before).map(request => JSON.stringify(request.body));
    expect(rejected).toContain(CIPHER);
    expect(resent).not.toContain(CIPHER);
    expect(rejected).toContain('"id":"fc_fixture"');
    expect(resent).not.toContain('"id":"fc_fixture"');
    expect(resent).toContain('call-1');
    expect(resent).toContain('LOOKUP RESULT');
    expect(resent).toContain('FOUND');
    expect(resent).toContain('Continue writing');
    expect(f.session.getLastAssistantText()).toBe('CONTINUED');
    expect(toolExecutions).toBe(1);
    // Pi still emits the failed attempt; the Storyflow presentation gate hides it (prompt-retry tests).
    expect(shownEvents).toHaveLength(1);
    // Append-only: every entry that existed before the recovery is untouched.
    expect(f.session.sessionManager.getEntries().slice(0, historyBefore.length)).toEqual(historyBefore);
    expect(f.session.messages.some(message => message.role === 'assistant' && message.stopReason === 'error')).toBe(false);

    // The recovery point survives for later turns: no new failure, no stale ciphertext.
    const next = f.requests.length;
    await f.session.prompt('And the next scene');
    await f.session.waitForIdle();
    expect(f.requests.length - next).toBe(1);
    expect(JSON.stringify(f.requests.at(-1)!.body)).not.toContain(CIPHER);
    expect(f.session.getLastAssistantText()).toBe('CONTINUED');
  }, (model, _index, body) => {
    const text = JSON.stringify(body);
    if (rotated && text.includes(CIPHER)) return invalidEncrypted();
    if (rotated) return responsesTurn(model, { cipher: 'CIPHER-FROM-ACCOUNT-B', text: 'CONTINUED' });
    return text.includes('LOOKUP RESULT')
      ? responsesTurn(model, { cipher: CIPHER, text: 'FOUND' })
      : responsesTurn(model, { cipher: CIPHER, call: { id: 'call-1', name: 'lookup' } });
  }, undefined, { api: 'openai-responses', models: ['gpt-5.6-luna'], tools: [lookup] });
});

test('a recovery that fails again ends the turn with the original error after two requests', async () => {
  let rotated = false;
  await fixture(async f => {
    await f.session.prompt('First');
    await f.session.waitForIdle();
    rotated = true;
    const before = f.requests.length;
    await f.session.prompt('Second');
    await f.session.waitForIdle();
    expect(f.requests.length - before).toBe(2);
    const failure = f.session.messages.at(-1)!;
    expect(failure).toMatchObject({ role: 'assistant', stopReason: 'error', errorMessage: expect.stringContaining('invalid_encrypted_content') });
  }, model => rotated ? invalidEncrypted() : responsesTurn(model, { cipher: CIPHER, text: 'OK' }),
  undefined, { api: 'openai-responses', models: ['gpt-5.6-luna'] });
});

test('a cancelled turn does not send a recovery request', async () => {
  let rotated = false;
  const abortOnFailure: InlineExtension = {
    name: 'abort-on-failure',
    factory(pi) {
      pi.on('message_end', (event, ctx) => {
        if (rotated && event.message.role === 'assistant' && event.message.stopReason === 'error') ctx.abort();
      });
    },
  };
  await fixture(async f => {
    await f.session.prompt('First');
    await f.session.waitForIdle();
    rotated = true;
    const before = f.requests.length;
    await f.session.prompt('Second');
    await f.session.waitForIdle();
    expect(f.requests.length - before).toBe(1);
  }, (model, _index, body) => rotated && JSON.stringify(body).includes(CIPHER) ? invalidEncrypted() : responsesTurn(model, { cipher: CIPHER, text: 'OK' }),
  abortOnFailure, { api: 'openai-responses', models: ['gpt-5.6-luna'] });
});
