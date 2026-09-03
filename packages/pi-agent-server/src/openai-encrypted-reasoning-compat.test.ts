// input: Synthetic OpenAI Responses assistant history with encrypted reasoning signatures
// output: Regression coverage for invalid_encrypted_content strip-and-retry degradation
// pos: Contract test pinning the compat extension against pi-ai's Responses replay
//      and retryable-error classifier, so a pi-ai upgrade that changes either
//      contract fails here instead of in production.

import { describe, expect, it } from 'bun:test';
import type { Context, Model } from '@earendil-works/pi-ai';
import { isRetryableAssistantError } from '@earendil-works/pi-ai/compat';
import { convertResponsesMessages } from '@earendil-works/pi-ai/api/openai-responses-shared';
import {
  ENCRYPTED_CONTENT_RETRY_GUIDANCE,
  createOpenAIEncryptedReasoningCompat,
  isEncryptedContentError,
  stripEncryptedReasoning,
} from './openai-encrypted-reasoning-compat.ts';

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const model: Model<'openai-responses'> = {
  id: 'gpt-5.2',
  name: 'gpt-5.2',
  api: 'openai-responses',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  reasoning: true,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 400_000,
  maxTokens: 128_000,
};

const REASONING_ITEM = {
  type: 'reasoning',
  id: 'rs_abc',
  encrypted_content: 'gAAAA-stale-blob',
  summary: [],
};

function assistantHistory(): Context['messages'] {
  return [
    { role: 'user', content: 'Inspect the active session.', timestamp: 1 },
    {
      role: 'assistant',
      provider: 'openai',
      api: 'openai-responses',
      model: 'gpt-5.2',
      content: [
        {
          type: 'thinking',
          thinking: 'summary text',
          thinkingSignature: JSON.stringify(REASONING_ITEM),
        },
        { type: 'text', text: 'Checking.', textSignature: JSON.stringify({ id: 'msg_abc' }) },
        {
          type: 'toolCall',
          id: 'call-1|fc_abc',
          name: 'get_session_info',
          arguments: {},
        },
      ],
      usage,
      stopReason: 'toolUse',
      timestamp: 2,
    },
    {
      role: 'toolResult',
      toolCallId: 'call-1|fc_abc',
      toolName: 'get_session_info',
      content: [{ type: 'text', text: '{"id":"session-1"}' }],
      isError: false,
      timestamp: 3,
    },
  ];
}

function convert(messages: Context['messages']) {
  return convertResponsesMessages(model, { messages }, new Set(['openai']));
}

describe('isEncryptedContentError', () => {
  it('matches the provider error code and prose', () => {
    expect(
      isEncryptedContentError(
        'OpenAI API error (400): {"message":"The encrypted content for item rs_abc could not be verified. Reason: Encrypted content could not be decrypted or parsed.","type":"invalid_request_error","code":"invalid_encrypted_content"}',
      ),
    ).toBe(true);
    expect(isEncryptedContentError('OpenAI API error (400): invalid_encrypted_content')).toBe(true);
    expect(isEncryptedContentError('OpenAI API error (429): rate limit')).toBe(false);
  });
});

describe('stripEncryptedReasoning', () => {
  it('replays stale history as pure content: no reasoning items, no pairing ids', () => {
    const before = convert(assistantHistory());
    expect(before.some((item: any) => item.type === 'reasoning')).toBe(true);
    expect(before.find((item: any) => item.type === 'function_call')?.id).toBe('fc_abc');

    const stripped = stripEncryptedReasoning(assistantHistory() as any, Date.now());
    const after = convert(stripped as any);
    expect(after.some((item: any) => item.type === 'reasoning')).toBe(false);
    const functionCall = after.find((item: any) => item.type === 'function_call') as any;
    expect(functionCall.id).toBeUndefined();
    expect(functionCall.call_id).toBe('call-1');
    const outputText = after
      .filter((item: any) => item.type === 'message' && item.role === 'assistant')
      .flatMap((item: any) => item.content)
      .map((part: any) => part.text);
    expect(outputText).toEqual(['Checking.']);
  });

  it('leaves messages after the trip point and other providers untouched', () => {
    const history = assistantHistory();
    const untouched = stripEncryptedReasoning(history as any, 1);
    expect(untouched).toEqual(history);

    const anthropic = [{
      role: 'assistant',
      api: 'anthropic-messages',
      provider: 'anthropic',
      content: [{ type: 'thinking', thinking: 'x', thinkingSignature: 'sig' }],
      timestamp: 2,
    }];
    expect(stripEncryptedReasoning(anthropic as any, Date.now())).toEqual(anthropic);
  });
});

describe('ENCRYPTED_CONTENT_RETRY_GUIDANCE', () => {
  it('is classified retryable by pi-ai so Pi auto-retry re-runs the stripped turn', () => {
    expect(
      isRetryableAssistantError({
        stopReason: 'error',
        errorMessage: `OpenAI API error (400): invalid_encrypted_content (${ENCRYPTED_CONTENT_RETRY_GUIDANCE})`,
      } as any),
    ).toBe(true);
    expect(
      isRetryableAssistantError({
        stopReason: 'error',
        errorMessage: 'OpenAI API error (400): invalid_encrypted_content',
      } as any),
    ).toBe(false);
  });
});

describe('createOpenAIEncryptedReasoningCompat', () => {
  it('retains the recovery watermark when Pi rebuilds the extension runner', () => {
    const extension = createOpenAIEncryptedReasoningCompat();
    const load = () => {
      const handlers = new Map<string, (event: any) => any>();
      extension.factory({
        on(event: string, handler: (payload: any) => any) {
          handlers.set(event, handler);
        },
      } as any);
      return handlers;
    };

    const firstRunner = load();
    firstRunner.get('message_end')?.({
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'OpenAI API error (400): invalid_encrypted_content',
      },
    });

    const reloadedRunner = load();
    const result = reloadedRunner.get('context')?.({ messages: assistantHistory() });
    expect(result?.messages).toBeDefined();
    expect(convert(result.messages).some((item: any) => item.type === 'reasoning')).toBe(false);
  });
});
