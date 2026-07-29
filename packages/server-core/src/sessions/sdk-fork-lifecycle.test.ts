// input: Pending SDK-fork metadata after a Pi child session is established
// output: Regression coverage for one-shot fork-state retirement
// pos: Guards SessionManager against re-forking the parent on agent recreation

import { describe, expect, it } from 'bun:test'
import { consumePendingSdkFork } from './SessionManager.ts'

describe('consumePendingSdkFork', () => {
  it('uses the strategy as authority and clears every runtime fork pointer', () => {
    const state: {
      branchContextStrategy: 'sdk-fork'
      branchFromSdkSessionId?: string
      branchFromSessionPath?: string
      branchFromSdkCwd?: string
      branchFromSdkTurnId?: string
      branchFromMessageId: string
    } = {
      branchContextStrategy: 'sdk-fork',
      branchFromSdkSessionId: undefined,
      branchFromSessionPath: '/workspace/sessions/parent',
      branchFromSdkCwd: '/workspace',
      branchFromSdkTurnId: 'pi-entry-1',
      branchFromMessageId: 'assistant-message-1',
    }

    expect(consumePendingSdkFork(state)).toBe(true)
    expect(state).toEqual({
      branchContextStrategy: 'sdk-fork',
      branchFromSdkSessionId: undefined,
      branchFromSessionPath: undefined,
      branchFromSdkCwd: undefined,
      branchFromSdkTurnId: undefined,
      branchFromMessageId: 'assistant-message-1',
    })
  })
})
