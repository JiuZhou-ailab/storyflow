// input: SessionItem source and messaging binding subscription contracts
// output: Regression coverage for per-row subscription boundaries
// pos: Keeps session rows from rerendering for unrelated messaging binding updates

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const sessionItemSource = readFileSync(new URL('../SessionItem.tsx', import.meta.url), 'utf-8')

describe('session item subscriptions', () => {
  it('reads messaging bindings through a per-session atom', () => {
    expect(sessionItemSource).toContain('messagingBindingsForSessionAtomFamily')
    expect(sessionItemSource).toContain('useAtomValue(messagingBindingsForSessionAtomFamily(item.id))')
    expect(sessionItemSource).not.toContain('useAtomValue(messagingBindingsBySessionAtom)')
    expect(sessionItemSource).not.toContain('messagingBindingsBySession.get(item.id)')
  })
})
