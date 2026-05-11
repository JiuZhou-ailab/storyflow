// input: Selected novel workspace file content and save/open callbacks
// output: Middle-column Markdown document editor surface
// pos: Replaces the session-list navigator column for novel writing workspaces

import * as React from 'react'
import { AlertCircle, Check, ChevronLeft, ChevronRight, GitPullRequestArrow, Loader2, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ShikiDiffViewer, UnifiedDiffViewer, type FileChange } from '@craft-agent/ui'
import { TiptapMarkdownEditor } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { NovelWorkspaceFile } from '@/lib/writing-workspace'
import { formatNovelWorkspaceFileTitle } from './novel-file-display'

export function countMarkdownTextCharacters(markdown: string): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, ''))
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~]/g, '')

  return text.match(/[\p{L}\p{N}]/gu)?.length ?? 0
}

export interface NovelSelectionAiRequest {
  selectedText: string
  instruction: string
}

export interface NovelDocumentEditorPanelProps {
  file?: NovelWorkspaceFile
  content: string
  loading: boolean
  saving: boolean
  error?: string | null
  onChange: (content: string) => void
  onAskAiForSelection?: (request: NovelSelectionAiRequest) => Promise<string>
  reviewChange?: FileChange
  pendingChangeCount?: number
  pendingFileIndex?: number
  onAcceptReviewChange?: () => void
  onAcceptAllReviewChanges?: () => void
  onRejectReviewChange?: () => void
  onPreviousReviewFile?: () => void
  onNextReviewFile?: () => void
  className?: string
}

export function NovelDocumentEditorPanel({
  file,
  content,
  loading,
  saving,
  error,
  onChange,
  onAskAiForSelection,
  reviewChange,
  pendingChangeCount = 0,
  pendingFileIndex,
  onAcceptReviewChange,
  onAcceptAllReviewChanges,
  onRejectReviewChange,
  onPreviousReviewFile,
  onNextReviewFile,
  className,
}: NovelDocumentEditorPanelProps) {
  const { t } = useTranslation()
  const characterCount = React.useMemo(() => countMarkdownTextCharacters(content), [content])

  if (!file) {
    return (
      <div className={cn('flex h-full min-w-0 flex-col bg-background', className)}>
        <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
          {t('writing.emptySection')}
        </div>
      </div>
    )
  }

  return (
    <div className={cn('flex h-full min-w-0 flex-col bg-background', className)}>
      {error ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate">{error}</span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('fileViewer.loadingContent')}
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            {reviewChange ? (
              <NovelInlineReviewDiff
                change={reviewChange}
                className="max-h-[45%] min-h-[180px] shrink-0"
              />
            ) : null}
            <TiptapMarkdownEditor
              content={content}
              onUpdate={onChange}
              placeholder={t('writing.emptySection')}
              editable={!saving}
              markdownEngine="official"
              showToolbar
              surface="manuscript"
              showLineNumbers
              bottomRightAccessory={t('writing.totalCharacters', 'Total {{count}} characters', { count: characterCount })}
              onAskAiForSelection={onAskAiForSelection}
              className="min-h-0 flex-1"
            />
          </div>
        )}
      </div>

      {pendingChangeCount > 0 ? (
        <div className="flex min-h-11 shrink-0 items-center gap-2 border-t border-border/60 bg-background px-3">
          <GitPullRequestArrow className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground">
            <span className="font-medium text-foreground/75">
              {pendingFileIndex != null && pendingFileIndex >= 0
                ? t('writing.review.fileProgress', '{{current}} / {{total}} files with changes', {
                    current: pendingFileIndex + 1,
                    total: pendingChangeCount,
                  })
                : t('writing.review.pendingFiles', '{{count}} files with changes', { count: pendingChangeCount })}
            </span>
            {reviewChange ? (
              <span className="ml-2">{formatNovelWorkspaceFileTitle(file, t)}</span>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={pendingChangeCount === 0 || !onPreviousReviewFile}
            onClick={onPreviousReviewFile}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={pendingChangeCount === 0 || !onNextReviewFile}
            onClick={onNextReviewFile}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={pendingChangeCount === 0 || !onAcceptAllReviewChanges}
            onClick={onAcceptAllReviewChanges}
          >
            <Check className="h-3.5 w-3.5" />
            {t('common.acceptAll', 'Accept all')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={!reviewChange || !onRejectReviewChange}
            onClick={onRejectReviewChange}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('common.reject', 'Reject')}
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={!reviewChange || !onAcceptReviewChange}
            onClick={onAcceptReviewChange}
          >
            <Check className="h-3.5 w-3.5" />
            {t('common.accept', 'Accept')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function NovelInlineReviewDiff({ change, className }: { change: FileChange; className?: string }) {
  return (
    <div
      className={cn('flex min-h-0 flex-col border-b border-border/60 bg-background', className)}
      data-testid="novel-inline-review-diff"
    >
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3">
        <div className="min-w-0 truncate text-xs font-medium text-foreground/75">
          Inline diff
        </div>
        <div className="shrink-0 text-[11px] text-muted-foreground">
          {change.toolType}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {change.unifiedDiff ? (
          <UnifiedDiffViewer
            unifiedDiff={change.unifiedDiff}
            filePath={change.filePath}
            diffStyle="unified"
            disableFileHeader
            className="h-full"
          />
        ) : (
          <ShikiDiffViewer
            original={change.original}
            modified={change.modified}
            filePath={change.filePath}
            diffStyle="unified"
            disableFileHeader
            className="h-full"
          />
        )}
      </div>
    </div>
  )
}
