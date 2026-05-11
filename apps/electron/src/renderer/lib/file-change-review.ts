// input: Captured file change metadata and current file content
// output: Safe accept/reject helpers for reviewable file changes
// pos: Renderer-side guardrail between diff review UI and filesystem writes

import type { FileChange } from '@craft-agent/ui'

export type RejectedFileContentResult =
  | { ok: true; content: string }
  | { ok: false; reason: string }

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

export function buildRejectedFileContent(
  change: FileChange,
  currentContent: string,
): RejectedFileContentResult {
  if (change.error) {
    return { ok: false, reason: 'Failed changes cannot be rejected from the review surface.' }
  }

  if (change.unifiedDiff) {
    return { ok: false, reason: 'Patch-only diffs cannot be reversed safely yet.' }
  }

  if (change.toolType === 'Write' && !change.original) {
    return { ok: false, reason: 'Previous file content was not captured for this write.' }
  }

  if (!change.modified) {
    return { ok: false, reason: 'Empty replacements cannot be reversed without a stable insertion point.' }
  }

  if (currentContent === change.modified) {
    return { ok: true, content: change.original }
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
    content: currentContent.replace(change.modified, change.original),
  }
}
