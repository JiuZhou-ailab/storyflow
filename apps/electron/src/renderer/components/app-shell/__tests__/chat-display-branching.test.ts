// input: Branch navigation requests with and without legacy new-panel hints.
// output: Regression proof that branch creation always reuses the focused panel.
// pos: Focused guard for the writing workspace's single-conversation-panel invariant.

import { describe, expect, it } from 'bun:test'
import { resolveBranchNewPanelOption } from '../branching'

describe('ChatDisplay branching navigation option', () => {
  it('defaults to reusing the focused panel when options are missing', () => {
    expect(resolveBranchNewPanelOption(undefined)).toBe(false)
  })

  it('respects explicit newPanel=false', () => {
    expect(resolveBranchNewPanelOption({ newPanel: false })).toBe(false)
  })

  it('ignores legacy newPanel=true requests', () => {
    expect(resolveBranchNewPanelOption({ newPanel: true })).toBe(false)
  })
})
