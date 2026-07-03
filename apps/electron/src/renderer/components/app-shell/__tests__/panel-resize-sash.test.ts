// input: PanelResizeSash source and panel stack subscription contract
// output: Regression coverage for high-frequency resize subscription boundaries
// pos: Keeps resize handles from rerendering on every panel proportion update

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const source = readFileSync(new URL('../PanelResizeSash.tsx', import.meta.url), 'utf-8')

describe('panel resize sash subscriptions', () => {
  it('reads panel stack imperatively during pointer handlers instead of subscribing in render', () => {
    expect(source).toContain('useStore')
    expect(source).toContain('store.get(panelStackAtom)')
    expect(source).not.toContain('useAtomValue(panelStackAtom)')
  })
})
