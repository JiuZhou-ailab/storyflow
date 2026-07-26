// input: Canonical Storyflow-to-Pi thinking-level mappings
// output: Regression coverage for native Pi reasoning effort forwarding
// pos: Unit test for the Pi thinking contract

import { describe, expect, it } from 'bun:test'
import { THINKING_TO_PI } from './constants.ts'

describe('THINKING_TO_PI', () => {
  it('maps xhigh to Pi xhigh natively', () => {
    expect(THINKING_TO_PI.xhigh).toBe('xhigh')
  })

  it('passes max through natively (Pi clamps per model)', () => {
    expect(THINKING_TO_PI.max).toBe('max')
  })

  it('passes lower tiers through unchanged', () => {
    expect(THINKING_TO_PI.off).toBe('off')
    expect(THINKING_TO_PI.low).toBe('low')
    expect(THINKING_TO_PI.medium).toBe('medium')
    expect(THINKING_TO_PI.high).toBe('high')
  })
})
