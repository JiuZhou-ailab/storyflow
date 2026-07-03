// input: TelegramAccessSection source and messaging binding subscription contract
// output: Regression coverage for settings access banner subscription boundaries
// pos: Keeps the Telegram access section from rerendering on unrelated binding updates

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const source = readFileSync(new URL('../TelegramAccessSection.tsx', import.meta.url), 'utf-8')

describe('TelegramAccessSection subscriptions', () => {
  it('reads only the open Telegram binding flag from messaging atoms', () => {
    expect(source).toContain('hasOpenTelegramBindingAtom')
    expect(source).toContain('useAtomValue(hasOpenTelegramBindingAtom)')
    expect(source).not.toContain('useAtomValue(messagingBindingsAtom)')
  })
})
