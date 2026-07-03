// input: ToolbarStatusSlot source and browser instance subscription contract
// output: Regression coverage for per-session browser status subscriptions
// pos: Keeps each input toolbar from rerendering on unrelated browser pane updates

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const source = readFileSync(new URL('../ToolbarStatusSlot.tsx', import.meta.url), 'utf-8')

describe('toolbar status slot subscriptions', () => {
  it('reads browser status through a per-session atom', () => {
    expect(source).toContain('browserInstanceForSessionAtomFamily')
    expect(source).toContain('useAtomValue(browserInstanceForSessionAtomFamily(sessionId))')
    expect(source).not.toContain('useAtomValue(browserInstancesAtom)')
  })
})
