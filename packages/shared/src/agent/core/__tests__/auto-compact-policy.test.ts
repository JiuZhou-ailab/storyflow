// input: User-turn counters and backend context availability
// output: Regression coverage for proactive long-context compaction decisions
// pos: Guards provider-agnostic compaction scheduling before backend chat turns

import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_AUTO_COMPACT_INTERVAL_USER_ITERATIONS,
  DEFAULT_AUTO_COMPACT_START_USER_ITERATION,
  shouldAutoCompact,
} from '../auto-compact-policy'

describe('auto compact policy', () => {
  it('does not compact before a provider session exists', () => {
    const decision = shouldAutoCompact({
      userIteration: DEFAULT_AUTO_COMPACT_START_USER_ITERATION,
      hasCompactionCapability: true,
      hasProviderSession: false,
    })

    expect(decision.shouldCompact).toBe(false)
    expect(decision.reason).toBe('backend session is not established')
  })

  it('starts proactive compaction once the session reaches the long-context threshold', () => {
    const decision = shouldAutoCompact({
      userIteration: DEFAULT_AUTO_COMPACT_START_USER_ITERATION,
      hasCompactionCapability: true,
      hasProviderSession: true,
    })

    expect(decision.shouldCompact).toBe(true)
    expect(decision.reason).toContain('reached proactive compaction threshold')
  })

  it('keeps enough distance between proactive compactions', () => {
    const tooSoon = shouldAutoCompact({
      userIteration: DEFAULT_AUTO_COMPACT_START_USER_ITERATION + DEFAULT_AUTO_COMPACT_INTERVAL_USER_ITERATIONS - 1,
      lastCompactedUserIteration: DEFAULT_AUTO_COMPACT_START_USER_ITERATION,
      hasCompactionCapability: true,
      hasProviderSession: true,
    })
    const readyAgain = shouldAutoCompact({
      userIteration: DEFAULT_AUTO_COMPACT_START_USER_ITERATION + DEFAULT_AUTO_COMPACT_INTERVAL_USER_ITERATIONS,
      lastCompactedUserIteration: DEFAULT_AUTO_COMPACT_START_USER_ITERATION,
      hasCompactionCapability: true,
      hasProviderSession: true,
    })

    expect(tooSoon.shouldCompact).toBe(false)
    expect(tooSoon.reason).toBe('below interval threshold')
    expect(readyAgain.shouldCompact).toBe(true)
  })

  it('skips hidden and retry messages', () => {
    const base = {
      userIteration: DEFAULT_AUTO_COMPACT_START_USER_ITERATION,
      hasCompactionCapability: true,
      hasProviderSession: true,
    }

    expect(shouldAutoCompact({ ...base, isHiddenUserMessage: true }).shouldCompact).toBe(false)
    expect(shouldAutoCompact({ ...base, isRetry: true }).shouldCompact).toBe(false)
  })
})
