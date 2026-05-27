// input: Chat page source and header action contracts
// output: Regression coverage for visible chat header controls
// pos: Keeps primary chat header actions discoverable in the Electron renderer

import { readFileSync } from 'fs'
import { describe, expect, it } from 'bun:test'

describe('chat page header actions', () => {
  it('renders the new session action with a visible text label', () => {
    const chatPageSource = readFileSync(new URL('../ChatPage.tsx', import.meta.url), 'utf-8')
    const newSessionButtonSource = chatPageSource.slice(
      chatPageSource.indexOf('const newSessionButton = React.useMemo'),
      chatPageSource.indexOf('<StyledContextMenuContent>')
    )

    expect(newSessionButtonSource).toContain('icon={(')
    expect(newSessionButtonSource).toContain('<SquarePenRounded className="h-4 w-4" />')
    expect(newSessionButtonSource).toContain(
      '<span className="text-[11px] font-medium leading-none">{t("session.newSession")}</span>'
    )
  })
})
