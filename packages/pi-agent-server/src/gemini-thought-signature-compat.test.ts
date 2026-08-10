// input: Pi cross-provider tool history and Google Gemini model metadata
// output: Regression coverage for Gemini 3 unsigned function-call replay
// pos: Dependency contract test for Pi's Google message adapter

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

function firstFunctionCallThoughtSignature(model: Model<'google-generative-ai'>, context: Context) {
  const contents = convertMessages(model, context)
  return contents
    .flatMap(content => content.parts ?? [])
    .find(part => part.functionCall)
    ?.thoughtSignature
}

describe('Gemini thought-signature compatibility', () => {
  it('uses the documented sentinel for every unsigned tool call replayed into Gemini 3', () => {
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

    expect(firstFunctionCallThoughtSignature(googleModel('gemini-3.1-pro-preview'), foreignContext))
      .toBe('skip_thought_signature_validator')
    expect(firstFunctionCallThoughtSignature(
      googleModel('gemini-3.1-pro-preview', 'custom-endpoint'),
      unsignedNativeContext,
    ))
      .toBe('skip_thought_signature_validator')
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
