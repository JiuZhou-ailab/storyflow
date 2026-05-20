// input: Novel review changes, current file content, and current review status
// output: Regression coverage for review undo entries
// pos: Unit tests for application-level undo of novel review actions

import { describe, expect, it } from 'bun:test'
import type { FileChange } from '@craft-agent/ui'
import { buildAcceptNovelChangeUndoEntry, buildRejectNovelChangeUndoEntry } from '../novel-review-undo'
import { getNovelReviewChangeKey, type NovelReviewStatusMap } from '../novel-review-workflow'

function change(overrides: Partial<FileChange> = {}): FileChange {
  return {
    id: overrides.id ?? 'change-1',
    filePath: overrides.filePath ?? '/novel/story/chapters/chapter-01.md',
    toolType: overrides.toolType ?? 'Edit',
    original: overrides.original ?? 'old sentence',
    modified: overrides.modified ?? 'new sentence',
    unifiedDiff: overrides.unifiedDiff,
    error: overrides.error,
  }
}

describe('novel review undo entries', () => {
  it('undoes an accepted change by restoring the original content and marking the change rejected', () => {
    const acceptedChange = change()
    const currentStatus: NovelReviewStatusMap = {}
    const result = buildAcceptNovelChangeUndoEntry(
      acceptedChange,
      'A new sentence.',
      currentStatus
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.entry.writes).toEqual([
      {
        filePath: acceptedChange.filePath,
        content: 'A old sentence.',
      },
    ])
    expect(result.entry.status).toEqual({
      [getNovelReviewChangeKey(acceptedChange)]: 'rejected',
    })
  })

  it('undoes a rejected change by restoring the content from before rejection and previous status', () => {
    const rejectedChange = change()
    const currentStatus: NovelReviewStatusMap = {}
    const entry = buildRejectNovelChangeUndoEntry(
      rejectedChange,
      'A new sentence.',
      currentStatus
    )

    expect(entry.writes).toEqual([
      {
        filePath: rejectedChange.filePath,
        content: 'A new sentence.',
      },
    ])
    expect(entry.status).toEqual({})
  })
})
