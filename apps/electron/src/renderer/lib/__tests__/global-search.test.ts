// input: Session metadata and writing workspace file fixtures
// output: Regression coverage for global search result construction
// pos: Guards the top-bar global search dialog data pipeline

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { SessionMeta } from '@/atoms/sessions'
import type { NovelWorkspaceFile } from '../writing-workspace'
import { buildGlobalSearchResults } from '../global-search'

function session(overrides: Partial<SessionMeta> & Pick<SessionMeta, 'id'>): SessionMeta {
  return {
    id: overrides.id,
    workspaceId: 'workspace-1',
    name: overrides.name,
    preview: overrides.preview,
    lastMessageAt: overrides.lastMessageAt ?? 0,
    isArchived: overrides.isArchived,
    hidden: overrides.hidden,
  } as SessionMeta
}

function novelFile(path: string, relativePath: string): NovelWorkspaceFile {
  return { path, relativePath }
}

describe('buildGlobalSearchResults', () => {
  it('keeps top-N limiting inside result collection instead of sorting every match', () => {
    const source = readFileSync(new URL('../global-search.ts', import.meta.url), 'utf8')

    expect(source).not.toContain('.sort(compareByScoreThenRecent)\n    .slice(0, MAX_RESULTS_PER_GROUP)')
    expect(source).not.toContain('.sort(compareFileResults)\n    .slice(0, MAX_RESULTS_PER_GROUP)')
  })

  it('reuses one collator for file result ordering', () => {
    const source = readFileSync(new URL('../global-search.ts', import.meta.url), 'utf8')

    expect(source).toContain('const globalSearchFileCollator = new Intl.Collator')
    expect(source).toContain('globalSearchFileCollator.compare(a.file.relativePath, b.file.relativePath)')
    expect(source).not.toContain("a.file.relativePath.localeCompare(b.file.relativePath, undefined, { numeric: true, sensitivity: 'base' })")
  })

  it('returns no results until the query has at least two visible characters', () => {
    const results = buildGlobalSearchResults({
      query: ' a ',
      sessions: [session({ id: 's1', name: 'Alpha session' })],
      novelFiles: [novelFile('/novel/story/chapters/chapter-01.md', 'story/chapters/chapter-01.md')],
      formatNovelFileTitle: file => file.relativePath,
    })

    expect(results.sessions).toEqual([])
    expect(results.files).toEqual([])
  })

  it('matches sessions by title or preview and skips hidden sessions', () => {
    const results = buildGlobalSearchResults({
      query: 'dragon',
      sessions: [
        session({ id: 's1', name: 'Dragon outline', lastMessageAt: 20 }),
        session({ id: 's2', preview: 'Scene about a dragon egg', lastMessageAt: 30 }),
        session({ id: 's3', name: 'Dragon private', hidden: true, lastMessageAt: 40 }),
        session({ id: 's4', name: 'Market scan', lastMessageAt: 10 }),
      ],
      novelFiles: [],
      formatNovelFileTitle: file => file.relativePath,
    })

    expect(results.sessions.map(result => result.session.id)).toEqual(['s2', 's1'])
  })

  it('returns only the highest ranked session matches', () => {
    const results = buildGlobalSearchResults({
      query: 'dragon',
      sessions: Array.from({ length: 10 }, (_, index) =>
        session({
          id: `s${index + 1}`,
          name: 'Dragon outline',
          lastMessageAt: index + 1,
        }),
      ),
      novelFiles: [],
      formatNovelFileTitle: file => file.relativePath,
    })

    expect(results.sessions.map(result => result.session.id)).toEqual(['s10', 's9', 's8', 's7', 's6', 's5', 's4', 's3'])
  })

  it('bounds results at product scale (300 sessions + 400 chapters)', () => {
    // Standard-fixture shape proxy: must stay top-N bounded without materializing full sorted arrays.
    const sessions = Array.from({ length: 300 }, (_, index) =>
      session({
        id: `s${index + 1}`,
        name: index % 3 === 0 ? `Chapter notes ${index}` : `Session ${index}`,
        preview: index % 5 === 0 ? 'dragon scene beat' : 'quiet morning',
        lastMessageAt: index + 1,
      }),
    )
    const novelFiles = Array.from({ length: 400 }, (_, index) => {
      const n = String(index + 1).padStart(3, '0')
      return novelFile(`/novel/正文/第${n}章.md`, `正文/第${n}章.md`)
    })

    const results = buildGlobalSearchResults({
      query: '第01',
      sessions,
      novelFiles,
      formatNovelFileTitle: file => file.relativePath.split('/').pop() ?? file.relativePath,
    })

    expect(results.files.length).toBeLessThanOrEqual(8)
    expect(results.sessions.length).toBeLessThanOrEqual(8)
    expect(results.files.length).toBeGreaterThan(0)
  })

  it('includes sessions found by full-text content search results', () => {
    const results = buildGlobalSearchResults({
      query: 'dragon',
      sessions: [
        session({ id: 's1', name: 'Market scan', preview: 'No fantasy terms here', lastMessageAt: 10 }),
      ],
      novelFiles: [],
      sessionContentResults: new Map([
        ['s1', { matchCount: 3, snippet: 'The dragon turns at the gate.' }],
      ]),
      formatNovelFileTitle: file => file.relativePath,
    })

    expect(results.sessions.map(result => result.session.id)).toEqual(['s1'])
    expect(results.sessions[0]?.preview).toBe('The dragon turns at the gate.')
    expect(results.sessions[0]?.matchCount).toBe(3)
  })

  it('matches writing files by display title and relative path', () => {
    const results = buildGlobalSearchResults({
      query: 'chapter',
      sessions: [],
      novelFiles: [
        novelFile('/novel/story/chapters/chapter-01.md', 'story/chapters/chapter-01.md'),
        novelFile('/novel/bible/characters/alice.md', 'bible/characters/alice.md'),
      ],
      formatNovelFileTitle: file => file.relativePath.includes('chapter-01') ? 'Opening Chapter' : 'Alice',
    })

    expect(results.files.map(result => result.file.path)).toEqual(['/novel/story/chapters/chapter-01.md'])
    expect(results.files[0]?.title).toBe('Opening Chapter')
  })
})
