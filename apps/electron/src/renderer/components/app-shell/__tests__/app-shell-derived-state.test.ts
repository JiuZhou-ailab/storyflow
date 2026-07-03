// input: AppShell source
// output: Guards pure derived session status data from extra React state writes
// pos: Keeps status config changes from adding an avoidable AppShell render pass

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const appShellSource = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8')

describe('AppShell derived state', () => {
  it('derives session statuses with memo instead of effect state', () => {
    expect(appShellSource).not.toContain('setSessionStatuses')
    expect(appShellSource).not.toContain('useState<SessionStatus[]>')
    expect(appShellSource).toContain('const sessionStatuses = React.useMemo(() => {')
  })
})
