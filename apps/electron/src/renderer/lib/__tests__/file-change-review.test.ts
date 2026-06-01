// input: Captured FileChange records and current file content examples
// output: Regression coverage for safe reject-content generation
// pos: Guards novel review actions against unsafe filesystem rollback

import { describe, expect, it } from 'bun:test'
import type { FileChange } from '@craft-agent/ui'
import {
  buildRejectFileChangeOperation,
  buildRejectFileChangesOperation,
  buildReviewFileChange,
  resolveReviewFileChangeSnapshot,
} from '../file-change-review'

function change(overrides: Partial<FileChange> = {}): FileChange {
  return {
    id: overrides.id ?? 'change-1',
    filePath: overrides.filePath ?? '/novel/story/chapters/chapter-01.md',
    toolType: overrides.toolType ?? 'Edit',
    changeKind: overrides.changeKind,
    original: overrides.original ?? 'old sentence',
    modified: overrides.modified ?? 'new sentence',
    unifiedDiff: overrides.unifiedDiff,
    error: overrides.error,
  }
}

describe('buildRejectFileChangeOperation', () => {
  it('replaces a uniquely matched modified snippet with the original snippet', () => {
    const result = buildRejectFileChangeOperation(
      change({ changeKind: 'modify', original: 'quiet room', modified: 'crowded room' }),
      'She crossed the crowded room before dawn.'
    )

    expect(result).toEqual({
      ok: true,
      operation: 'write',
      content: 'She crossed the quiet room before dawn.',
    })
  })

  it('rejects full-file replacements when the whole current file matches the modified content', () => {
    const result = buildRejectFileChangeOperation(
      change({ changeKind: 'replace', original: '# Chapter 1\n\nOld', modified: '# Chapter 1\n\nNew' }),
      '# Chapter 1\n\nNew'
    )

    expect(result).toEqual({
      ok: true,
      operation: 'write',
      content: '# Chapter 1\n\nOld',
    })
  })

  it('rejects created files by deleting them when the current content still matches', () => {
    const result = buildRejectFileChangeOperation(
      change({ toolType: 'Write', changeKind: 'create', original: '', modified: '# New file' }),
      '# New file'
    )

    expect(result).toEqual({
      ok: true,
      operation: 'delete',
    })
  })

  it('refuses to reject a change when the modified snippet is no longer present', () => {
    const result = buildRejectFileChangeOperation(
      change({ original: 'quiet room', modified: 'crowded room' }),
      'She crossed the empty room before dawn.'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('Current file no longer matches')
    }
  })

  it('refuses ambiguous replacements when the modified snippet appears more than once', () => {
    const result = buildRejectFileChangeOperation(
      change({ original: 'quiet room', modified: 'crowded room' }),
      'crowded room\ncrowded room'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('appears more than once')
    }
  })

  it('refuses ambiguous replacements when matches overlap', () => {
    const result = buildRejectFileChangeOperation(
      change({ original: 'old', modified: 'ana' }),
      'banana'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('appears more than once')
    }
  })

  it('refuses patch-only diffs until the original snippet is available', () => {
    const result = buildRejectFileChangeOperation(
      change({ original: '', modified: '', unifiedDiff: '@@ -1 +1 @@\n-old\n+new' }),
      'new'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('Patch-only')
    }
  })

  it('refuses write changes without captured previous content', () => {
    const result = buildRejectFileChangeOperation(
      change({ toolType: 'Write', changeKind: 'replace', original: '', modified: '# New file' }),
      '# New file'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('Previous file content was not captured')
    }
  })

  it('reverts write changes when captured previous content is available', () => {
    const result = buildRejectFileChangeOperation(
      change({ toolType: 'Write', changeKind: 'replace', original: '# Old file', modified: '# New file' }),
      '# New file'
    )

    expect(result).toEqual({
      ok: true,
      operation: 'write',
      content: '# Old file',
    })
  })

  it('rejects multiple changes in one file while preserving unrelated user edits', () => {
    const changes = [
      change({ id: 'change-1', original: 'quiet room', modified: 'crowded room' }),
      change({ id: 'change-2', original: 'before dawn', modified: 'under red moonlight' }),
    ]

    const result = buildRejectFileChangesOperation(
      changes,
      'User note.\nShe crossed the crowded room under red moonlight.'
    )

    expect(result).toEqual({
      ok: true,
      operation: 'write',
      content: 'User note.\nShe crossed the quiet room before dawn.',
    })
  })

  it('rejects sequential edits at the same location in reverse change order', () => {
    const changes = [
      change({ id: 'change-1', original: 'quiet room', modified: 'crowded room' }),
      change({ id: 'change-2', original: 'crowded room', modified: 'burning hall' }),
    ]

    const result = buildRejectFileChangesOperation(
      changes,
      'She crossed the burning hall.'
    )

    expect(result).toEqual({
      ok: true,
      operation: 'write',
      content: 'She crossed the quiet room.',
    })
  })

  it('builds one file-level review change from multiple snippet edits', () => {
    const changes = [
      change({ id: 'change-1', original: 'quiet room', modified: 'crowded room' }),
      change({ id: 'change-2', original: 'before dawn', modified: 'under red moonlight' }),
    ]

    expect(buildReviewFileChange(
      changes,
      'User note.\nShe crossed the crowded room under red moonlight.'
    )).toEqual({
      id: 'file-review:change-1:change-2',
      filePath: '/novel/story/chapters/chapter-01.md',
      toolType: 'Edit',
      changeKind: 'modify',
      original: 'User note.\nShe crossed the quiet room before dawn.',
      modified: 'User note.\nShe crossed the crowded room under red moonlight.',
    })
  })

  it('keeps the review baseline stable when the user edits during review', () => {
    const changes = [
      change({ id: 'change-1', original: 'quiet room', modified: 'crowded room' }),
    ]

    const first = resolveReviewFileChangeSnapshot(
      null,
      changes,
      'She crossed the crowded room.'
    )
    const second = resolveReviewFileChangeSnapshot(
      first,
      changes,
      'She crossed the crowded warm room.'
    )

    expect(first.change?.original).toBe('She crossed the quiet room.')
    expect(second).toBe(first)
    expect(second.change?.original).toBe('She crossed the quiet room.')
  })
})
