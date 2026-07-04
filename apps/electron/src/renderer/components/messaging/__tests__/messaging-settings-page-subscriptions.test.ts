// input: MessagingSettingsPage source and playground preview wiring
// output: Regression coverage for messaging settings workspace subscriptions
// pos: Keeps messaging settings on the shared window workspace atom

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const pageSource = readFileSync(new URL('../../../pages/settings/MessagingSettingsPage.tsx', import.meta.url), 'utf-8')
const previewSource = readFileSync(new URL('../../../playground/demos/messaging/MessagingSettingsPagePreview.tsx', import.meta.url), 'utf-8')

describe('MessagingSettingsPage subscriptions', () => {
  it('reads the active workspace id from the shared window workspace atom', () => {
    expect(pageSource).not.toContain('useActiveWorkspace')
    expect(pageSource).not.toContain('useAppShellContext')
    expect(pageSource).toContain('windowWorkspaceIdAtom')
    expect(pageSource).toContain('useAtomValue(windowWorkspaceIdAtom)')
  })

  it('seeds the shared workspace atom in the playground preview', () => {
    expect(previewSource).toContain('windowWorkspaceIdAtom')
    expect(previewSource).toContain('setWindowWorkspaceId(PLAYGROUND_WORKSPACE_ID)')
  })
})
