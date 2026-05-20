// input: Novel review changes, current file content, and review status
// output: Application-level undo entries for accept/reject review actions
// pos: Pure helper for writing-workspace review undo behavior

import type { FileChange } from '@craft-agent/ui'
import { buildRejectedFileContent } from './file-change-review'
import {
  getNovelReviewChangeKey,
  type NovelReviewStatusMap,
} from './novel-review-workflow'

export interface NovelReviewUndoWrite {
  filePath: string
  content: string
}

export interface NovelReviewUndoEntry {
  status: NovelReviewStatusMap
  writes: NovelReviewUndoWrite[]
}

export type AcceptNovelChangeUndoEntryResult =
  | { ok: true; entry: NovelReviewUndoEntry }
  | { ok: false; reason: string }

export function buildAcceptNovelChangeUndoEntry(
  change: FileChange,
  currentContent: string,
  currentStatus: NovelReviewStatusMap,
): AcceptNovelChangeUndoEntryResult {
  const rejected = buildRejectedFileContent(change, currentContent)
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
      writes: [
        {
          filePath: change.filePath,
          content: rejected.content,
        },
      ],
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
  }
}
