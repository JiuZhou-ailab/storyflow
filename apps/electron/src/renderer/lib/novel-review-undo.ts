// input: Novel review changes, current file content, and review status
// output: Application-level undo entries for accept/reject review actions
// pos: Pure helper for writing-workspace review undo behavior

import type { FileChange } from '@craft-agent/ui'
import { buildRejectFileChangeOperation } from './file-change-review'
import {
  getNovelReviewChangeKey,
  type NovelReviewStatusMap,
} from './novel-review-workflow'

export interface NovelReviewUndoWrite {
  filePath: string
  content: string
}

export interface NovelReviewUndoDelete {
  filePath: string
}

export interface NovelReviewUndoEntry {
  status: NovelReviewStatusMap
  writes: NovelReviewUndoWrite[]
  deletes: NovelReviewUndoDelete[]
}

export type AcceptNovelChangeUndoEntryResult =
  | { ok: true; entry: NovelReviewUndoEntry }
  | { ok: false; reason: string }

export function buildAcceptNovelChangeUndoEntry(
  change: FileChange,
  currentContent: string,
  currentStatus: NovelReviewStatusMap,
): AcceptNovelChangeUndoEntryResult {
  const rejected = buildRejectFileChangeOperation(change, currentContent)
  if (!rejected.ok) {
    return rejected
  }

  return {
    ok: true,
    entry: {
      status: {
        ...currentStatus,
        [getNovelReviewChangeKey(change)]: 'rejected',
      },
      writes: rejected.operation === 'write'
        ? [
            {
              filePath: change.filePath,
              content: rejected.content,
            },
          ]
        : [],
      deletes: rejected.operation === 'delete'
        ? [
            {
              filePath: change.filePath,
            },
          ]
        : [],
    },
  }
}

export function buildRejectNovelChangeUndoEntry(
  change: FileChange,
  currentContent: string,
  currentStatus: NovelReviewStatusMap,
): NovelReviewUndoEntry {
  return {
    status: currentStatus,
    writes: [
      {
        filePath: change.filePath,
        content: currentContent,
      },
    ],
    deletes: [],
  }
}
