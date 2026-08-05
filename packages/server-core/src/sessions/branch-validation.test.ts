import { describe, expect, it } from 'bun:test'
import { requireSdkForkBranchAnchor } from './SessionManager.ts'

describe('requireSdkForkBranchAnchor', () => {
  it('rejects Pi fork branches without a Pi cutoff anchor', () => {
    expect(() => requireSdkForkBranchAnchor({
      branchFromSessionId: 'parent-session',
      branchFromMessageId: 'plan-message',
      branchFromSdkTurnId: undefined,
    })).toThrow('selected message is missing a Pi branch anchor')
  })

  it('keeps valid Pi cutoff anchors', () => {
    expect(requireSdkForkBranchAnchor({
      branchFromSessionId: 'parent-session',
      branchFromMessageId: 'assistant-message',
      branchFromSdkTurnId: 'msg_abc123',
    })).toBe('msg_abc123')
  })
})
