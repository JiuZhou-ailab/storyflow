// input: Pi cross-provider tool history and Google Gemini model metadata
// output: Regression coverage for Gemini 3 unsigned function-call replay
// pos: Dependency contract test pinning pi-ai's Google adapter replay behavior
//      (explicit tool-call ids since 0.84.4; previously a Storyflow patch added
//      the skip_thought_signature_validator sentinel to pi-ai 0.84.1)

import { describe, expect, it } from 'bun:test'
import type { Context, Model } from '@earendil-works/pi-ai'
import { convertMessages } from '@earendil-works/pi-ai/api/google-shared'

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

function googleModel(id: string, provider = 'google'): Model<'google-generative-ai'> {
  return {
    id,
    name: id,
    api: 'google-generative-ai',
    provider,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_048_576,
    maxTokens: 65_536,
  }
}

function toolHistory(input: {
  provider: string
  api: string
  model: string
  thoughtSignature?: string
}): Context {
  return {
    messages: [
      { role: 'user', content: 'Inspect the active session.', timestamp: 1 },
      {
        role: 'assistant',
        provider: input.provider,
        api: input.api,
        model: input.model,
        content: [{
          type: 'toolCall',
          id: 'call-1',
          name: 'get_session_info',
          arguments: {},
          ...(input.thoughtSignature ? { thoughtSignature: input.thoughtSignature } : {}),
        }],
        usage,
        stopReason: 'toolUse',
        timestamp: 2,
      },
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'get_session_info',
        content: [{ type: 'text', text: '{"id":"session-1"}' }],
        isError: false,
        timestamp: 3,
      },
    ],
  }
}

function firstFunctionCallPart(model: Model<'google-generative-ai'>, context: Context) {
  const contents = convertMessages(model, context)
  return contents
    .flatMap(content => content.parts ?? [])
    .find(part => part.functionCall)
}

function firstFunctionCallThoughtSignature(model: Model<'google-generative-ai'>, context: Context) {
  return firstFunctionCallPart(model, context)?.thoughtSignature
}

describe('Gemini thought-signature compatibility', () => {
  it('replays unsigned tool calls into Gemini 3 with explicit tool-call ids instead of signatures', () => {
    // Since pi-ai 0.84.4, unsigned function calls rely on requiresToolCallId
    // (explicit ids for Gemini >= 3) rather than the former
    // skip_thought_signature_validator sentinel.
    const foreignContext = toolHistory({
      provider: 'deepseek',
      api: 'openai-completions',
      model: 'deepseek-v4-flash',
    })
    const unsignedNativeContext = toolHistory({
      provider: 'custom-endpoint',
      api: 'google-generative-ai',
      model: 'gemini-3.1-pro-preview',
    })

    for (const context of [foreignContext, unsignedNativeContext]) {
      const part = firstFunctionCallPart(googleModel('gemini-3.1-pro-preview'), context)
      expect(part?.functionCall?.id).toBe('call-1')
      expect(part?.thoughtSignature).toBeUndefined()
    }
  })

  it('preserves genuine Gemini signatures and leaves pre-Gemini-3 history unchanged', () => {
    const genuineSignature = 'QUJDRA=='
    const nativeContext = toolHistory({
      provider: 'google',
      api: 'google-generative-ai',
      model: 'gemini-3.1-pro-preview',
      thoughtSignature: genuineSignature,
    })
    const foreignContext = toolHistory({
      provider: 'deepseek',
      api: 'openai-completions',
      model: 'deepseek-v4-flash',
    })

    expect(firstFunctionCallThoughtSignature(googleModel('gemini-3.1-pro-preview'), nativeContext))
      .toBe(genuineSignature)
    expect(firstFunctionCallThoughtSignature(googleModel('gemini-2.5-pro'), foreignContext))
      .toBeUndefined()
  })
})
