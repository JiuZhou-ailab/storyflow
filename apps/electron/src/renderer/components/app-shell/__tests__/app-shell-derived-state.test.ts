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

  it('derives workspace session buckets in one pass', () => {
    expect(appShellSource).toContain('const sessionMetaBuckets = useMemo(() => {')
    expect(appShellSource).toContain('for (const meta of sessionMetaMap.values())')
    expect(appShellSource).toContain('archivedSessionMetas')
    expect(appShellSource).not.toContain('Array.from(sessionMetaMap.values())')
    expect(appShellSource).not.toContain('workspaceSessionMetas.filter(s => s.isArchived)')
  })

  it('keeps global search file title formatting callback stable across shell renders', () => {
    expect(appShellSource).toContain('const formatGlobalSearchNovelFileTitle = useCallback(')
    expect(appShellSource).toContain('formatNovelFileTitle={formatGlobalSearchNovelFileTitle}')
    expect(appShellSource).not.toContain('formatNovelFileTitle={(file) => formatNovelWorkspaceFileTitle(file, t)}')
  })

  it('derives remote workspace availability outside SessionList render props', () => {
    expect(appShellSource).toContain('const hasRemoteWorkspaces = useMemo(')
    expect(appShellSource).toContain('hasRemoteWorkspaces={hasRemoteWorkspaces}')
    expect(appShellSource).not.toContain('hasRemoteWorkspaces={workspaces.some')
  })

  it('keeps automation list filter identity stable across shell renders', () => {
    expect(appShellSource).toContain('const automationListFilter = useMemo(')
    expect(appShellSource).toContain('automationFilter={automationListFilter}')
    expect(appShellSource).not.toContain('automationFilter={automationFilter ? { kind:')
  })
})
