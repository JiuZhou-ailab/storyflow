// input: Batch automation menu source
// output: Regression coverage for workspace-id subscription boundaries
// pos: Keeps automation batch actions off broad app shell context updates

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const batchAutomationMenuSource = readFileSync(new URL('../BatchAutomationMenu.tsx', import.meta.url), 'utf-8')

describe('batch automation menu subscriptions', () => {
  it('reads active workspace id from the shared workspace atom', () => {
    expect(batchAutomationMenuSource).toContain('windowWorkspaceIdAtom')
    expect(batchAutomationMenuSource).toContain('useAtomValue(windowWorkspaceIdAtom)')
    expect(batchAutomationMenuSource).not.toContain('useAppShellContext')
  })
})
