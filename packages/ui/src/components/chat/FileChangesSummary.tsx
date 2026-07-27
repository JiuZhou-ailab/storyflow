// input: File changes from one assistant turn and review actions
// output: Compact expandable diff summary card
// pos: Turn footer entry point into the right-side diff review workspace

import * as React from 'react'
import { ChevronDown, ChevronUp, Files, RotateCcw } from 'lucide-react'
import { parseDiffFromFile, type FileContents } from '@pierre/diffs'
import { useTranslation } from 'react-i18next'
import { getDiffStats } from '../code-viewer/ShikiDiffViewer'
import { getUnifiedDiffStats } from '../code-viewer/UnifiedDiffViewer'
import { cn } from '../../lib/utils'
import type { FileChange } from '../overlay/MultiDiffPreviewOverlay'

interface FileSummary {
  path: string
  additions: number
  deletions: number
}

function getStats(change: FileChange): { additions: number; deletions: number } {
  if (change.unifiedDiff) {
    return getUnifiedDiffStats(change.unifiedDiff, change.filePath) ?? { additions: 0, deletions: 0 }
  }
  const oldFile: FileContents = { name: change.filePath, contents: change.original }
  const newFile: FileContents = { name: change.filePath, contents: change.modified }
  return getDiffStats(parseDiffFromFile(oldFile, newFile))
}

export function summarizeFileChanges(changes: FileChange[]): FileSummary[] {
  const files = new Map<string, FileSummary>()
  for (const change of changes) {
    if (change.error) continue
    const stats = getStats(change)
    const current = files.get(change.filePath) ?? {
      path: change.filePath,
      additions: 0,
      deletions: 0,
    }
    current.additions += stats.additions
    current.deletions += stats.deletions
    files.set(change.filePath, current)
  }
  return [...files.values()]
}

export interface FileChangesSummaryProps {
  changes: FileChange[]
  onOpen: () => void
  onRevert?: () => void
  reverting?: boolean
  className?: string
}

export function FileChangesSummary({
  changes,
  onOpen,
  onRevert,
  reverting = false,
  className,
}: FileChangesSummaryProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = React.useState(false)
  const files = React.useMemo(() => summarizeFileChanges(changes), [changes])
  const totals = React.useMemo(() => files.reduce(
    (result, file) => ({
      additions: result.additions + file.additions,
      deletions: result.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  ), [files])
  const visibleFiles = expanded ? files : files.slice(0, 3)

  if (files.length === 0) return null

  return (
    <section className={cn('mt-3 overflow-hidden rounded-xl border border-border/60 bg-background', className)}>
      <div className="flex items-center gap-3 p-3">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Files className="h-4 w-4 text-muted-foreground" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">
              {t('chat.fileChanges.editedFiles', {
                count: files.length,
                defaultValue: `已编辑 ${files.length} 个文件`,
              })}
            </span>
            <span className="text-xs tabular-nums">
              <span className="text-success">+{totals.additions}</span>
              {' '}
              <span className="text-destructive">-{totals.deletions}</span>
            </span>
          </span>
        </button>
        {onRevert ? (
          <button
            type="button"
            onClick={onRevert}
            disabled={reverting}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {reverting
              ? t('chat.fileChanges.reverting', '撤回中…')
              : t('common.revert', '撤回')}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onOpen}
          className="h-8 rounded-lg border border-border/60 px-3 text-xs font-medium hover:bg-muted"
        >
          {t('chat.fileChanges.review', '审核')}
        </button>
      </div>
      <div className="border-t border-border/50 px-3 py-2">
        {visibleFiles.map((file) => (
          <button
            type="button"
            key={file.path}
            onClick={onOpen}
            className="flex w-full items-center gap-3 rounded-md px-1 py-1.5 text-left text-xs hover:bg-muted/50"
          >
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{file.path}</span>
            <span className="shrink-0 tabular-nums">
              <span className="text-success">+{file.additions}</span>
              {' '}
              <span className="text-destructive">-{file.deletions}</span>
            </span>
          </button>
        ))}
        {files.length > 3 ? (
          <button
            type="button"
            onClick={() => setExpanded(value => !value)}
            className="mt-1 flex h-7 items-center gap-1 px-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {expanded
              ? t('chat.fileChanges.collapse', '收起')
              : t('chat.fileChanges.showMore', {
                  count: files.length - 3,
                  defaultValue: `再显示 ${files.length - 3} 个文件`,
                })}
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        ) : null}
      </div>
    </section>
  )
}
