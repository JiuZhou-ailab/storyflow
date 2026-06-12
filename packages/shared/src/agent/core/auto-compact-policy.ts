// input: Per-session turn counters and backend compaction capability
// output: Provider-agnostic decision for proactive conversation compaction
// pos: Shared policy gate that keeps long-running agent sessions from waiting for overflow

export const DEFAULT_AUTO_COMPACT_START_USER_ITERATION = 18
export const DEFAULT_AUTO_COMPACT_INTERVAL_USER_ITERATIONS = 10

export interface AutoCompactPolicyInput {
  userIteration: number
  lastCompactedUserIteration?: number
  hasCompactionCapability: boolean
  hasProviderSession: boolean
  isRetry?: boolean
  isHiddenUserMessage?: boolean
}

export interface AutoCompactDecision {
  shouldCompact: boolean
  reason?: string
}

export function shouldAutoCompact(input: AutoCompactPolicyInput): AutoCompactDecision {
  if (!input.hasCompactionCapability) {
    return { shouldCompact: false, reason: 'backend has no compaction capability' }
  }
  if (!input.hasProviderSession) {
    return { shouldCompact: false, reason: 'backend session is not established' }
  }
  if (input.isRetry) {
    return { shouldCompact: false, reason: 'retry turn' }
  }
  if (input.isHiddenUserMessage) {
    return { shouldCompact: false, reason: 'hidden/internal message' }
  }

  const userIteration = Math.max(0, Math.floor(input.userIteration))
  if (userIteration < DEFAULT_AUTO_COMPACT_START_USER_ITERATION) {
    return { shouldCompact: false, reason: 'below start threshold' }
  }

  const lastCompactedUserIteration = input.lastCompactedUserIteration ?? 0
  if (
    lastCompactedUserIteration > 0 &&
    userIteration - lastCompactedUserIteration < DEFAULT_AUTO_COMPACT_INTERVAL_USER_ITERATIONS
  ) {
    return { shouldCompact: false, reason: 'below interval threshold' }
  }

  return {
    shouldCompact: true,
    reason: `user iteration ${userIteration} reached proactive compaction threshold`,
  }
}
