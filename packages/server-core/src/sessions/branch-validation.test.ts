import { describe, expect, it } from 'bun:test'
import { requireSdkForkBranchAnchor } from './SessionManager.ts'

describe('requireSdkForkBranchAnchor', () => {
  it('rejects SDK fork branches without a provider-native cutoff anchor', () => {
    expect(() => requireSdkForkBranchAnchor({
      provider: 'anthropic',
      branchFromSessionId: 'parent-session',
      branchFromMessageId: 'plan-message',
      branchFromSdkTurnId: undefined,
    })).toThrow('selected message is missing a provider branch anchor')
  })

  it('keeps valid provider-native cutoff anchors', () => {
    expect(requireSdkForkBranchAnchor({
      provider: 'anthropic',
      branchFromSessionId: 'parent-session',
      branchFromMessageId: 'assistant-message',
      branchFromSdkTurnId: 'msg_abc123',
    })).toBe('msg_abc123')
  })
})
