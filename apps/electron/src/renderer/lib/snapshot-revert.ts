// input: Snapshot-sourced file states (base/head content) and the file's current on-disk content
// output: Three-way-safe revert plans that either restore a known state or report a conflict
// pos: Sound revert core for snapshot-sourced review, orthogonal to the snippet-matching fallback

/**
 * Why this exists separately from `file-change-review.ts`:
 *
 * `FileChange` is a *display* DTO — `original`/`modified` mean "the old and new
 * snippet" for an activity-sourced Edit, but "the whole file before and after"
 * for a snapshot-sourced change. Reverting needs a different question answered:
 * *what state do we expect the file to be in, and what state should it become?*
 *
 * Conflating those two shapes into one field pair is what forced the
 * substring-matching heuristic, which is unsound whenever a snippet occurs more
 * than once or a later write overwrote it. Here the two states are explicit, so
 * safety is structural rather than heuristic.
 *
 * Absence is `null`, never `''` — a file that does not exist and a file that is
 * empty are different states, and collapsing them makes create/delete reverts
 * ambiguous.
 */

/** A file state: `null` means the file does not exist at that point. */
export type FileState = string | null

export interface FileRevertPlan {
  /** Absolute path of the file this plan applies to. */
  filePath: string
  /** State the file is expected to currently be in for the revert to be safe. */
  expected: FileState
  /** State the file should be restored to. */
  target: FileState
}

export type RevertOperation =
  | { ok: true; operation: 'write'; content: string }
  | { ok: true; operation: 'delete' }
  | { ok: true; operation: 'noop' }
  | { ok: false; reason: 'conflict' }

/**
 * Builds the operation that reverts a file, refusing when the file no longer
 * matches the reviewed result.
 *
 * A mismatch means someone (the human, a later agent turn, or an external
 * process) changed the file after the reviewed change landed. Overwriting that
 * silently would discard work the system never saw — the human's edits are
 * first-class input, so the conflict is surfaced instead of resolved.
 */
export function buildRevertOperation(plan: FileRevertPlan, current: FileState): RevertOperation {
  if (current !== plan.expected) return { ok: false, reason: 'conflict' }
  if (plan.target === plan.expected) return { ok: true, operation: 'noop' }
  if (plan.target === null) return { ok: true, operation: 'delete' }
  return { ok: true, operation: 'write', content: plan.target }
}

export type WorkspaceChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed'

/**
 * Derives the `changeKind` a snapshot-sourced change should carry.
 *
 * `deleted` maps to `'delete'` rather than `'replace'`: a deletion's post-state
 * is absence, and describing it as a replacement with empty content is exactly
 * the ambiguity this module exists to remove.
 */
export function getSnapshotChangeKind(status: WorkspaceChangeStatus): 'create' | 'modify' | 'delete' {
  if (status === 'added') return 'create'
  if (status === 'deleted') return 'delete'
  return 'modify'
}

export interface BuildSnapshotRevertPlanInput {
  filePath: string
  /** File content at the base commit — the state to restore. */
  baseContent: FileState
  /** File content at the head commit — the state the review was performed against. */
  headContent: FileState
}

export function buildSnapshotRevertPlan({
  filePath,
  baseContent,
  headContent,
}: BuildSnapshotRevertPlanInput): FileRevertPlan {
  return { filePath, expected: headContent, target: baseContent }
}
