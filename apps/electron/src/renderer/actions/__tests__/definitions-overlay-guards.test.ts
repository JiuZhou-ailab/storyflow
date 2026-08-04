// input: Action registry definitions for renderer keyboard shortcuts
// output: Regression coverage for overlay-safe global shortcuts
// pos: Guards action metadata that prevents modal stacking regressions

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { actions } from '../definitions'

const appShellSource = readFileSync(
  new URL('../../components/app-shell/AppShell.tsx', import.meta.url),
  'utf8',
)

describe('action overlay guards', () => {
  it('does not open global search while another menu or dialog is open', () => {
    expect(actions['app.search'].when).toBe('!menuOpen')
  })

  it('keeps Shift+Tab split between zone navigation and chat permission cycling', () => {
    expect(actions['nav.previousZone'].when).toBe('!inputFocus')
    expect(actions['chat.cyclePermissionMode'].when).toBe('chatFocus && inputFocus && !menuOpen')
  })

  it('reserves Ctrl+Tab for cycling sessions', () => {
    expect(actions['nav.nextSession'].defaultHotkey).toBe('ctrl+tab')
    expect(actions['nav.previousSession'].defaultHotkey).toBe('ctrl+shift+tab')
    expect(appShellSource).toContain("useAction('nav.nextSession', () => cycleSession(1))")
    expect(appShellSource).toContain("useAction('nav.previousSession', () => cycleSession(-1))")
    expect(appShellSource).toContain('navigateToSessionInPanel(nextSessionId)')
    expect(appShellSource).toContain('requestAnimationFrame(() => focusChatInputForSession(nextSessionId))')
  })
})
