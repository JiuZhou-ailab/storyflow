// input: AppShellContext session options hook source
// output: Regression coverage for session options subscription boundaries
// pos: Keeps per-session option controls off broad app-shell updates

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const contextSource = readFileSync(new URL('../AppShellContext.tsx', import.meta.url), 'utf-8')

describe('session options subscriptions', () => {
  it('uses a narrow action context for option writes', () => {
    const hookSource = contextSource.slice(
      contextSource.indexOf('export function useSessionOptionsFor'),
      contextSource.length,
    )

    expect(hookSource).not.toContain('useAppShellContext')
    expect(hookSource).toContain('useSessionOptionsActions')
    expect(contextSource).toContain('SessionOptionsActionsContext')
  })
})
