import { describe, expect, it } from 'bun:test'
import {
  formatTokenCount,
  resolveContextUsage,
} from '../context-usage'

describe('context usage helpers', () => {
  it('uses context tokens before input tokens for occupancy', () => {
    expect(resolveContextUsage({
      contextTokens: 50_000,
      inputTokens: 12_000,
      contextWindow: 200_000,
    })).toEqual({
      tokens: 50_000,
      contextWindow: 200_000,
      percent: 25,
      label: '25%',
      tokenLabel: '50k / 200k',
    })
  })

  it('falls back to input tokens when context tokens are unavailable', () => {
    expect(resolveContextUsage({
      inputTokens: 10_000,
      contextWindow: 100_000,
    })?.percent).toBe(10)
  })

  it('clamps usage at 100 percent', () => {
    expect(resolveContextUsage({
      contextTokens: 120_000,
      contextWindow: 100_000,
    })?.label).toBe('100%')
  })

  it('formats token counts compactly', () => {
    expect(formatTokenCount(999)).toBe('999')
    expect(formatTokenCount(1_500)).toBe('1.5k')
    expect(formatTokenCount(20_000)).toBe('20k')
    expect(formatTokenCount(2_400_000)).toBe('2.4M')
  })
})
