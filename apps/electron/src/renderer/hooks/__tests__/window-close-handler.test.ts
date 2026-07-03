// input: useWindowCloseHandler source and panel stack subscription contract
// output: Regression coverage for close-request handler subscription boundaries
// pos: Keeps window close handling from rerendering on unrelated panel stack updates

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const source = readFileSync(new URL('../useWindowCloseHandler.ts', import.meta.url), 'utf-8')

describe('useWindowCloseHandler subscriptions', () => {
  it('reads panel state imperatively when a close request arrives', () => {
    expect(source).toContain('useStore')
    expect(source).toContain('store.get(panelStackAtom)')
    expect(source).toContain('store.get(focusedPanelIdAtom)')
    expect(source).not.toContain('useAtomValue(panelStackAtom)')
    expect(source).not.toContain('useAtomValue(focusedPanelIdAtom)')
  })
})
