// input: App renderer source for active-viewing session updates
// output: Regression guard for idempotent active-viewing notifications
// pos: Prevents focus regain from rewriting unchanged session atoms

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf-8')

describe('active viewing session updates', () => {
  it('skips repeated active-viewing writes when the viewed session is already read', () => {
    const handlerStart = appSource.indexOf('const handleSetActiveViewingSession = useCallback')
    const handlerEnd = appSource.indexOf('const handleMarkSessionRead = useCallback', handlerStart)
    const handlerSource = appSource.slice(handlerStart, handlerEnd)

    expect(appSource).toContain('const activeViewingSessionIdRef = useRef<string | null>(null)')
    expect(handlerSource).toContain('const alreadyViewing = activeViewingSessionIdRef.current === sessionId')
    expect(handlerSource).toContain('if (alreadyViewing && currentSession?.hasUnread !== true) return')
    expect(handlerSource).toContain('if (currentSession?.hasUnread === true)')
  })
})
