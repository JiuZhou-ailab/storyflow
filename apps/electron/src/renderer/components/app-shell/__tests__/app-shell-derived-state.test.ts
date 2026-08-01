// input: AppShell source
// output: Guards pure derived session status data from extra React state writes
// pos: Keeps status config changes from adding an avoidable AppShell render pass

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const appShellSource = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8')
const sessionListSource = readFileSync(new URL('../SessionList.tsx', import.meta.url), 'utf8')

describe('AppShell derived state', () => {
  it('derives session statuses with memo instead of effect state', () => {
    expect(appShellSource).not.toContain('setSessionStatuses')
    expect(appShellSource).not.toContain('useState<SessionStatus[]>')
    expect(appShellSource).toContain('const sessionStatuses = React.useMemo(() => {')
  })

  it('keeps workspace session derivation and bucketing scoped to SessionList', () => {
    // Ctrl+Tab reads the atom only at action time; render-time derivation remains in SessionList.
    expect(appShellSource).not.toContain('useAtomValue(sessionMetaMapAtom)')
    expect(appShellSource).not.toContain('const workspaceSessionMetasAtom')
    expect(appShellSource).not.toContain('for (const meta of metaMap.values())')
    expect(appShellSource).toContain('store.get(sessionMetaMapAtom)')
    expect(sessionListSource).toContain('const workspaceSessionMetasAtom = useMemo(')
    expect(sessionListSource).toContain('selectAtom(')
    expect(sessionListSource).toContain('for (const meta of metaMap.values())')
    expect(sessionListSource).toContain('sameSessionMetas,')
    expect(sessionListSource).toContain('for (const item of workspaceItems)')
    expect(sessionListSource).not.toContain('Array.from(metaMap.values())')
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

  it('derives active filter chips before rendering the filter dropdown', () => {
    expect(appShellSource).toContain('const labelConfigById = useMemo(')
    expect(appShellSource).toContain('const activeStatusFilters = useMemo(')
    expect(appShellSource).toContain('const activeLabelFilters = useMemo(')
    expect(appShellSource).not.toContain('effectiveSessionStatuses.filter(s => listFilter.has(s.id)).map')
    expect(appShellSource).not.toContain('Array.from(labelFilter).map')
    expect(appShellSource).not.toContain('findLabelById(labelConfigs')
  })
})
