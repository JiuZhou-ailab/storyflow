// input: Review change lists and local review status maps
// output: Regression coverage for novel review navigation helpers
// pos: Guards Cursor-style changed-file review workflow

import { describe, expect, it } from 'bun:test'
import type { FileChange } from '@craft-agent/ui'
import {
  getAdjacentChangedFilePath,
  getPendingChangedFilePaths,
  getPendingChangesForFile,
  getNovelReviewChangeKey,
  normalizeNovelFileChangePaths,
  parseNovelReviewStatusMap,
} from '../novel-review-workflow'

function change(id: string, filePath: string): FileChange {
  return {
    id,
    filePath,
    toolType: 'Edit',
    original: 'old',
    modified: 'new',
  }
}

describe('novel review workflow', () => {
  it('deduplicates pending changed file paths in change order', () => {
    const changes = [
      change('a', '/novel/chapter-1.md'),
      change('b', '/novel/chapter-2.md'),
      change('c', '/novel/chapter-1.md'),
    ]

    expect(getPendingChangedFilePaths(changes, { b: 'accepted' })).toEqual([
      '/novel/chapter-1.md',
    ])
  })

  it('returns only pending changes for the selected file', () => {
    const changes = [
      change('a', '/novel/chapter-1.md'),
      change('b', '/novel/chapter-1.md'),
      change('c', '/novel/chapter-2.md'),
    ]

    expect(getPendingChangesForFile(changes, { a: 'rejected' }, '/novel/chapter-1.md').map(c => c.id)).toEqual(['b'])
  })

  it('keeps accepted decisions stable when activity ids change after reload', () => {
    const beforeReload = change('activity-before', '/novel/chapter-1.md')
    const afterReload = change('activity-after', '/novel/chapter-1.md')
    const status = {
      [getNovelReviewChangeKey(beforeReload)]: 'accepted' as const,
    }

    expect(getNovelReviewChangeKey(afterReload)).toBe(getNovelReviewChangeKey(beforeReload))
    expect(getPendingChangesForFile([afterReload], status, '/novel/chapter-1.md')).toEqual([])
    expect(getPendingChangedFilePaths([afterReload], status)).toEqual([])
  })

  it('keeps accepted decisions stable across sessions for the same workspace change', () => {
    const sessionAChange = change('session-a-activity', '/novel/chapter-1.md')
    const sessionBChange = change('session-b-activity', '/novel/chapter-1.md')
    const workspaceReviewStatus = {
      [getNovelReviewChangeKey(sessionAChange)]: 'accepted' as const,
    }

    expect(getPendingChangesForFile([sessionBChange], workspaceReviewStatus, '/novel/chapter-1.md')).toEqual([])
    expect(getPendingChangedFilePaths([sessionBChange], workspaceReviewStatus)).toEqual([])
  })

  it('hydrates only terminal review decisions for the current change set', () => {
    const changes = [
      change('a', '/novel/chapter-1.md'),
      change('b', '/novel/chapter-2.md'),
    ]

    expect(parseNovelReviewStatusMap({
      a: 'accepted',
      b: 'rejected',
      c: 'accepted',
      d: 'pending',
      e: 'unknown',
    }, changes)).toEqual({
      [getNovelReviewChangeKey(changes[0])]: 'accepted',
      [getNovelReviewChangeKey(changes[1])]: 'rejected',
    })
  })

  it('wraps next and previous changed-file navigation', () => {
    const paths = ['/novel/a.md', '/novel/b.md', '/novel/c.md']

    expect(getAdjacentChangedFilePath(paths, '/novel/a.md', 'previous')).toBe('/novel/c.md')
    expect(getAdjacentChangedFilePath(paths, '/novel/c.md', 'next')).toBe('/novel/a.md')
    expect(getAdjacentChangedFilePath(paths, '/novel/missing.md', 'next')).toBe('/novel/a.md')
  })

  it('normalizes relative agent change paths to workspace file paths before review matching', () => {
    const changes = [
      change('a', 'story/chapters/chapter-1.md'),
      change('b', './bible/characters/alice.md'),
    ]

    const normalized = normalizeNovelFileChangePaths(
      changes,
      '/novel',
      [
        { path: '/novel/story/chapters/chapter-1.md', relativePath: 'story/chapters/chapter-1.md' },
        { path: '/novel/bible/characters/alice.md', relativePath: 'bible/characters/alice.md' },
      ]
    )

    expect(getPendingChangedFilePaths(normalized, {})).toEqual([
      '/novel/story/chapters/chapter-1.md',
      '/novel/bible/characters/alice.md',
    ])
    expect(getPendingChangesForFile(normalized, {}, '/novel/story/chapters/chapter-1.md').map(c => c.id)).toEqual(['a'])
  })
})
