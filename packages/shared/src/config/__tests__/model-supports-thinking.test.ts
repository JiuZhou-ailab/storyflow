// input: LLM connection model entries with explicit or implicit thinking metadata
// output: Regression coverage for capability-driven thinking controls
// pos: Shared model capability policy tests

import { describe, expect, it } from 'bun:test'
import { modelSupportsThinking, type LlmConnection } from '../llm-connections.ts'

function connection(
  providerType: LlmConnection['providerType'],
  models: LlmConnection['models'],
): Pick<LlmConnection, 'providerType' | 'models'> {
  return { providerType, models }
}

describe('modelSupportsThinking', () => {
  it('requires custom endpoints to opt in per model', () => {
    expect(modelSupportsThinking(connection('pi_compat', ['unknown-model']), 'unknown-model')).toBe(false)
    expect(modelSupportsThinking(connection('pi_compat', [
      { id: 'reasoning-model', supportsThinking: true } as never,
      { id: 'plain-model', supportsThinking: false } as never,
    ]), 'reasoning-model')).toBe(true)
    expect(modelSupportsThinking(connection('pi_compat', [
      { id: 'reasoning-model', supportsThinking: true } as never,
      { id: 'plain-model', supportsThinking: false } as never,
    ]), 'plain-model')).toBe(false)
  })

  it('keeps SDK-owned model definitions opt-out', () => {
    expect(modelSupportsThinking(connection('pi', [
      { id: 'legacy-model' } as never,
      { id: 'plain-model', supportsThinking: false } as never,
    ]), 'legacy-model')).toBe(true)
    expect(modelSupportsThinking(connection('pi', [
      { id: 'plain-model', supportsThinking: false } as never,
    ]), 'plain-model')).toBe(false)
  })
})
