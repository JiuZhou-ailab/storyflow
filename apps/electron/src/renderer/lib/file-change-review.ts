// input: Captured file change metadata and current file content
// output: Safe accept/reject helpers for reviewable file changes
// pos: Renderer-side guardrail between diff review UI and filesystem writes

import type { FileChange } from '@craft-agent/ui'

export type RejectFileChangeOperationResult =
  | { ok: true; operation: 'write'; content: string }
  | { ok: true; operation: 'delete' }
  | { ok: false; reason: string }

export interface ReviewFileChangeSnapshot {
  key: string
  change: FileChange | null
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0

  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + 1)
  }
  return count
}

function getEffectiveChangeKind(change: FileChange): NonNullable<FileChange['changeKind']> {
  if (change.changeKind) return change.changeKind
  if (change.toolType === 'Write') return change.original ? 'replace' : 'create'
  return 'modify'
}

export function buildRejectFileChangeOperation(
  change: FileChange,
  currentContent: string,
): RejectFileChangeOperationResult {
  if (change.error) {
    return { ok: false, reason: 'Failed changes cannot be rejected from the review surface.' }
  }

  if (change.unifiedDiff) {
    return { ok: false, reason: 'Patch-only diffs cannot be reversed safely yet.' }
  }

  const changeKind = getEffectiveChangeKind(change)

  if (changeKind === 'create') {
    if (currentContent !== change.modified) {
      return { ok: false, reason: 'Current file no longer matches the reviewed creation.' }
    }
    return { ok: true, operation: 'delete' }
  }

  if (changeKind === 'replace' && !change.original) {
    return { ok: false, reason: 'Previous file content was not captured for this write.' }
  }

  if (!change.modified) {
    return { ok: false, reason: 'Empty replacements cannot be reversed without a stable insertion point.' }
  }

  if (currentContent === change.modified) {
    return { ok: true, operation: 'write', content: change.original }
  }

  if (changeKind === 'replace') {
    return { ok: false, reason: 'Current file no longer matches the reviewed replacement.' }
  }

  const occurrences = countOccurrences(currentContent, change.modified)
  if (occurrences === 0) {
    return { ok: false, reason: 'Current file no longer matches the reviewed change.' }
  }

  if (occurrences > 1) {
    return { ok: false, reason: 'The modified snippet appears more than once in the current file.' }
  }

  return {
    ok: true,
    operation: 'write',
    content: currentContent.replace(change.modified, change.original),
  }
}

export function buildRejectFileChangesOperation(
  changes: FileChange[],
  currentContent: string,
): RejectFileChangeOperationResult {
  const reviewableChanges = changes.filter(change => !change.error)
  if (reviewableChanges.length === 0) {
    return { ok: false, reason: 'There are no reviewable changes to reject.' }
  }

  const filePath = reviewableChanges[0]?.filePath
  if (!filePath || reviewableChanges.some(change => change.filePath !== filePath)) {
    return { ok: false, reason: 'A file-level rejection can only include one file.' }
  }

  let content = currentContent
  for (const change of [...reviewableChanges].reverse()) {
    const rejected = buildRejectFileChangeOperation(change, content)
    if (!rejected.ok) return rejected
    if (rejected.operation === 'delete') return rejected
    content = rejected.content
  }

  return {
    ok: true,
    operation: 'write',
    content,
  }
}

export function buildReviewFileChange(
  changes: FileChange[],
  currentContent: string,
): FileChange | null {
  const reviewableChanges = changes.filter(change => !change.error)
  if (reviewableChanges.length === 0) return null

  const filePath = reviewableChanges[0]?.filePath
  if (!filePath || reviewableChanges.some(change => change.filePath !== filePath)) return null

  const rejected = buildRejectFileChangesOperation(reviewableChanges, currentContent)
  if (!rejected.ok) return null

  return {
    id: `file-review:${reviewableChanges.map(change => change.id).join(':')}`,
    filePath,
    toolType: reviewableChanges.some(change => change.toolType === 'Write') ? 'Write' : 'Edit',
    changeKind: rejected.operation === 'delete' ? 'create' : 'modify',
    original: rejected.operation === 'delete' ? '' : rejected.content,
    modified: currentContent,
  }
}

function getReviewFileChangesKey(changes: FileChange[]): string {
  return changes
    .filter(change => !change.error)
    .map(change => [
      change.id,
      change.filePath,
      change.toolType,
      change.changeKind ?? '',
      change.original,
      change.modified,
      change.unifiedDiff ?? '',
    ].join('\u0000'))
    .join('\u0001')
}

export function resolveReviewFileChangeSnapshot(
  previous: ReviewFileChangeSnapshot | null,
  changes: FileChange[],
  currentContent: string,
): ReviewFileChangeSnapshot {
  const key = getReviewFileChangesKey(changes)
  if (previous?.key === key && (previous.change != null || key === '')) return previous

  return {
    key,
    change: buildReviewFileChange(changes, currentContent),
  }
}
