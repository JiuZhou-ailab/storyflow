// input: WhatsApp connect dialog source and call sites
// output: Regression coverage for workspace-id subscription boundaries
// pos: Keeps WhatsApp pairing dialog off broad app shell context updates

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const dialogSource = readFileSync(new URL('../WhatsAppConnectDialog.tsx', import.meta.url), 'utf-8')
const hostSource = readFileSync(new URL('../MessagingDialogHost.tsx', import.meta.url), 'utf-8')
const previewSource = readFileSync(new URL('../../../playground/demos/messaging/WhatsAppConnectDialogPreview.tsx', import.meta.url), 'utf-8')

describe('WhatsAppConnectDialog subscriptions', () => {
  it('receives workspace id from callers instead of app shell context', () => {
    expect(dialogSource).not.toContain('useActiveWorkspace')
    expect(dialogSource).not.toContain('useAppShellContext')
    expect(dialogSource).toContain('workspaceId?: string | null')
  })

  it('uses the shared workspace atom from the global messaging host', () => {
    expect(hostSource).toContain('windowWorkspaceIdAtom')
    expect(hostSource).toContain('useAtomValue(windowWorkspaceIdAtom)')
  })

  it('keeps playground WhatsApp events scoped to the preview workspace', () => {
    expect(previewSource).toContain('workspaceId="playground-workspace"')
  })
})
