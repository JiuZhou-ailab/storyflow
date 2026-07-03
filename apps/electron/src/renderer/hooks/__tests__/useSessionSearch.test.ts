import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'bun:test'
import { computeCollapsedPagination, getSessionDateGroupKey } from '../useSessionSearch'
import type { SessionMeta } from '@/atoms/sessions'

const useSessionSearchSource = readFileSync(
  fileURLToPath(new URL('../useSessionSearch.ts', import.meta.url)),
  'utf-8'
)

function makeSession(id: string, opts: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id,
    workspaceId: 'ws-1',
    sessionStatus: 'in-progress',
    lastMessageAt: Date.parse('2026-03-05T10:00:00.000Z'),
    ...opts,
  }
}

describe('computeCollapsedPagination', () => {
  it('builds stable date group keys from session activity time', () => {
    expect(getSessionDateGroupKey(makeSession('s1'))).toBe('2026-03-05T00:00:00.000Z')
    expect(getSessionDateGroupKey(makeSession('missing-date', { lastMessageAt: undefined }))).toBe('1970-01-01T00:00:00.000Z')
  })

  it('does not hide items when current view has only one group and that group is collapsed', () => {
    const sessions = [
      makeSession('s1'),
      makeSession('s2'),
    ]

    const result = computeCollapsedPagination(
      sessions,
      50,
      new Set(['2026-03-05T00:00:00.000Z']),
      'date'
    )

    expect(result.paginatedItems.map(s => s.id)).toEqual(['s1', 's2'])
    expect(result.collapsedGroupsMeta).toEqual([])
    expect(result.hasMore).toBe(false)
  })

  it('still collapses normally when multiple groups exist', () => {
    const sessions = [
      makeSession('today', { lastMessageAt: Date.parse('2026-03-06T10:00:00.000Z') }),
      makeSession('yesterday', { lastMessageAt: Date.parse('2026-03-05T10:00:00.000Z') }),
      makeSession('older', { lastMessageAt: Date.parse('2026-03-04T10:00:00.000Z') }),
    ]

    const result = computeCollapsedPagination(
      sessions,
      50,
      new Set(['2026-03-05T00:00:00.000Z']),
      'date'
    )

    expect(result.paginatedItems.map(s => s.id)).toEqual(['today', 'older'])
    expect(result.collapsedGroupsMeta).toEqual([{ key: '2026-03-05T00:00:00.000Z', count: 1 }])
    expect(result.hasMore).toBe(false)
  })

  it('ignores collapsed keys that are not present in current view', () => {
    const sessions = [
      makeSession('a', { sessionStatus: 'in-progress' }),
      makeSession('b', { sessionStatus: 'done' }),
    ]

    const result = computeCollapsedPagination(
      sessions,
      50,
      new Set(['status-todo']),
      'status'
    )

    expect(result.paginatedItems.map(s => s.id)).toEqual(['a', 'b'])
    expect(result.collapsedGroupsMeta).toEqual([])
  })

  it('does not regroup paginated results only to flatten them again', () => {
    expect(useSessionSearchSource).toContain('return paginatedItems')
    expect(useSessionSearchSource).not.toContain('groupSessionsByDate')
    expect(useSessionSearchSource).not.toContain('dateGroups.flatMap')
    expect(useSessionSearchSource).not.toContain('sessionIndexMap')
  })

  it('reuses computed collapse group keys while paginating', () => {
    expect(useSessionSearchSource).toContain('const itemGroupKeys: string[] = []')
    expect(useSessionSearchSource).toContain('const groupKey = itemGroupKeys[index]')
    expect(useSessionSearchSource).not.toContain('new Set(items.map(item => getCollapseGroupKey(item, groupingMode)))')
  })

  it('precomputes session search ranking keys before sorting results', () => {
    expect(useSessionSearchSource).toContain('const rankedSearchItems: { item: SessionMeta; score: number; matchCount: number }[] = []')
    expect(useSessionSearchSource).toContain('for (const item of sortedItems)')
    expect(useSessionSearchSource).toContain('const searchResult = contentSearchResults.get(item.id)')
    expect(useSessionSearchSource).toContain('score: fuzzyScore(getSessionTitle(item), searchQuery)')
    expect(useSessionSearchSource).toContain('matchCount: searchResult.matchCount')
    expect(useSessionSearchSource).not.toContain('.filter(item => contentSearchResults.has(item.id))')
    expect(useSessionSearchSource).not.toContain('const aScore = fuzzyScore(getSessionTitle(a), searchQuery)')
    expect(useSessionSearchSource).not.toContain('const countA = contentSearchResults.get(a.id)?.matchCount || 0')
  })

  it('parses session label ids once when matching label filters', () => {
    expect(useSessionSearchSource).toContain('const getSessionLabelIds = (): Set<string>')
    expect(useSessionSearchSource).toContain('const labelIds = getSessionLabelIds()')
    expect(useSessionSearchSource).toContain('labelIds.has(labelId)')
    expect(useSessionSearchSource).toContain('return getSessionLabelIds().has(currentFilter.labelId)')
    expect(useSessionSearchSource).not.toContain('session.labels?.map(l => parseLabelEntry(l).id)')
    expect(useSessionSearchSource).not.toContain('const labelIds = session.labels.map(l => parseLabelEntry(l).id)')
  })
})
