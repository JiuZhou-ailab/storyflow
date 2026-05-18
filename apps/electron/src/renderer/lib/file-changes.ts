// input: Completed tool activities from session turns.
// output: Normalized file-change records for diff overlays and review surfaces.
// pos: Renderer boundary adapter from backend tool payloads to UI diff models.

import { parsePatchFiles } from '@pierre/diffs'
import type { ActivityItem, FileChange } from '@craft-agent/ui'

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function getFilePath(input: Record<string, unknown>): string {
  return asString(input.file_path) || asString(input.path) || 'unknown'
}

function getEditChangeId(activityId: string, editIndex: number, editCount: number): string {
  return editCount <= 1 ? activityId : `${activityId}:${editIndex}`
}

function normalizePatchFilePath(path: string | undefined): string | undefined {
  if (!path || path === '/dev/null' || path === 'dev/null') return undefined
  if (path.startsWith('a/') || path.startsWith('b/')) return path.slice(2)
  return path
}

function getFilePathFromUnifiedDiff(diff: string | undefined): string | undefined {
  if (!diff?.trim()) return undefined

  try {
    const firstFile = parsePatchFiles(diff)[0]?.files[0]
    return normalizePatchFilePath(firstFile?.name)
  } catch {
    return undefined
  }
}

function getCodexChangeFilePath(change: { path?: string; diff?: string }): string {
  return normalizePatchFilePath(change.path)
    || getFilePathFromUnifiedDiff(change.diff)
    || 'unknown'
}

export interface CollectFileChangesOptions {
  basePath?: string
}

function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('~')
}

function resolveFileChangePath(path: string, basePath: string | undefined): string {
  if (!basePath || path === 'unknown' || isAbsoluteFilePath(path)) return path

  const normalizedBase = basePath.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedPath = path.replace(/\\/g, '/').replace(/^\.\/+/, '')
  const posixAbsoluteCandidate = `/${normalizedPath}`
  if (posixAbsoluteCandidate === normalizedBase || posixAbsoluteCandidate.startsWith(`${normalizedBase}/`)) {
    return posixAbsoluteCandidate
  }

  return `${normalizedBase}/${normalizedPath}`
}

export function collectFileChangesFromActivities(
  activities: ActivityItem[],
  options: CollectFileChangesOptions = {},
): FileChange[] {
  const changes: FileChange[] = []

  for (const activity of activities) {
    const input = activity.toolInput as Record<string, unknown> | undefined
    if (!input) continue

    if (activity.toolName === 'Edit') {
      // Codex format: { changes: Array<{ path, kind, diff }> }
      if (Array.isArray(input.changes)) {
        for (const codexChange of input.changes as Array<{ path?: string; diff?: string }>) {
          const filePath = resolveFileChangePath(getCodexChangeFilePath(codexChange), options.basePath)
          changes.push({
            id: `${activity.id}-${filePath}`,
            filePath,
            toolType: 'Edit',
            original: '',
            modified: '',
            unifiedDiff: codexChange.diff,
            error: activity.error || undefined,
          })
        }
        continue
      }

      // Pi SDK >= 0.63.2 edit format: { path, edits: [{ oldText, newText }] }
      if (Array.isArray(input.edits) && input.edits.length > 0) {
        const filePath = resolveFileChangePath(getFilePath(input), options.basePath)
        for (const [index, edit] of input.edits.entries()) {
          const currentEdit = (edit ?? {}) as { oldText?: unknown; newText?: unknown }
          changes.push({
            id: getEditChangeId(activity.id, index, input.edits.length),
            filePath,
            toolType: 'Edit',
            original: asString(currentEdit.oldText) || '',
            modified: asString(currentEdit.newText) || '',
            error: activity.error || undefined,
          })
        }
        continue
      }

      // Claude fields take precedence; legacy Pi fields are additive fallbacks.
      changes.push({
        id: activity.id,
        filePath: resolveFileChangePath(getFilePath(input), options.basePath),
        toolType: 'Edit',
        original: asString(input.old_string) || asString(input.oldText) || '',
        modified: asString(input.new_string) || asString(input.newText) || '',
        error: activity.error || undefined,
      })
      continue
    }

    if (activity.toolName === 'Write') {
      changes.push({
        id: activity.id,
        filePath: resolveFileChangePath(getFilePath(input), options.basePath),
        toolType: 'Write',
        original: '',
        modified: asString(input.content) || '',
        error: activity.error || undefined,
      })
    }
  }

  return changes
}

export function getFirstFileChangeIdForActivity(activityId: string, changes: FileChange[]): string | undefined {
  const exact = changes.find((change) => change.id === activityId)
  if (exact) return exact.id

  return changes.find((change) =>
    change.id.startsWith(`${activityId}:`) ||
    change.id.startsWith(`${activityId}-`),
  )?.id
}
