// input: Selected novel workspace file content, review changes, and save/open callbacks
// output: Middle-column Markdown document editor or inline review surface
// pos: Replaces the session-list navigator column for novel writing workspaces

import * as React from 'react'
import { AlertCircle, Check, ChevronLeft, ChevronRight, GitPullRequestArrow, Loader2, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FileChange } from '@craft-agent/ui'
import {
  buildNovelSelectionContext,
  formatNovelSelectionChatMessage,
  formatNovelSelectionContextForChat,
} from '@craft-agent/shared/writing/selection-context'
import { TiptapMarkdownEditor } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { resolveReviewFileChangeSnapshot, type ReviewFileChangeSnapshot } from '@/lib/file-change-review'
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

  const foldedText = text.replace(/(?:\u2026+|\.{3,})/gu, '…')
  return Array.from(foldedText).filter(character => !/\s/u.test(character)).length
}

export interface NovelSelectionAiRequest {
  selectedText: string
  instruction: string
}

export interface NovelSelectionChatRequest {
  selectedText: string
}

export interface NovelDocumentEditorPanelProps {
  file?: NovelWorkspaceFile
  content: string
  loading: boolean
  saving: boolean
  error?: string | null
  onChange: (content: string) => void
  onAskAiForSelection?: (request: NovelSelectionAiRequest) => Promise<string>
  onAddSelectionToChat?: (message: string) => void
  onSendSelectionToChat?: (message: string) => Promise<void> | void
  reviewChanges?: FileChange[]
  pendingChangeCount?: number
  pendingFileIndex?: number
  onAcceptReviewChanges?: () => void
  onAcceptAllReviewChanges?: () => void
  onRejectReviewChanges?: () => void
  onPreviousReviewFile?: () => void
  onNextReviewFile?: () => void
  workspaceActions?: React.ReactNode
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
  onAddSelectionToChat,
  onSendSelectionToChat,
  reviewChanges,
  pendingChangeCount = 0,
  pendingFileIndex,
  onAcceptReviewChanges,
  onAcceptAllReviewChanges,
  onRejectReviewChanges,
  onPreviousReviewFile,
  onNextReviewFile,
  workspaceActions,
  className,
}: NovelDocumentEditorPanelProps) {
  const { t } = useTranslation()
  const characterCount = React.useMemo(() => countMarkdownTextCharacters(content), [content])
  const reviewChangesForFile = React.useMemo(
    () => (reviewChanges ?? []).filter(change => !change.error),
    [reviewChanges]
  )
  const reviewChangeCount = reviewChangesForFile.length
  const reviewFileChangeSnapshotRef = React.useRef<ReviewFileChangeSnapshot | null>(null)
  const fileReviewChange = React.useMemo(
    () => {
      const snapshot = resolveReviewFileChangeSnapshot(
        reviewFileChangeSnapshotRef.current,
        reviewChangesForFile,
        content
      )
      reviewFileChangeSnapshotRef.current = snapshot
      return snapshot.change
    },
    [reviewChangesForFile, content]
  )
  const handleAddSelectionToChat = React.useCallback(({ selectedText }: NovelSelectionChatRequest) => {
    if (!file || !onAddSelectionToChat) return

    const context = buildNovelSelectionContext({
      content,
      selectedText,
      filePath: file.path,
      relativePath: file.relativePath,
    })
    onAddSelectionToChat(formatNovelSelectionContextForChat(context))
  }, [content, file, onAddSelectionToChat])
  const handleAskAiForSelection = React.useCallback(async ({ selectedText, instruction }: NovelSelectionAiRequest) => {
    if (file && onSendSelectionToChat) {
      const context = buildNovelSelectionContext({
        content,
        selectedText,
        filePath: file.path,
        relativePath: file.relativePath,
      })
      await onSendSelectionToChat(formatNovelSelectionChatMessage(context, instruction))
      return selectedText
    }

    if (!onAskAiForSelection) return selectedText
    return onAskAiForSelection({ selectedText, instruction })
  }, [content, file, onAskAiForSelection, onSendSelectionToChat])

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
      {workspaceActions ? (
        <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border/50 px-3">
          <div className="min-w-0 truncate text-xs font-medium text-muted-foreground">
            {formatNovelWorkspaceFileTitle(file, t)}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {workspaceActions}
          </div>
        </div>
      ) : null}

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
            <TiptapMarkdownEditor
              content={content}
              onUpdate={onChange}
              placeholder={t('writing.emptySection')}
              editable
              markdownEngine="official"
              showToolbar
              surface="manuscript"
              showLineNumbers
              reviewDiffOriginalContent={fileReviewChange?.original ?? null}
              bottomRightAccessory={t('writing.totalCharacters', { defaultValue: 'Total {{count}} characters', count: characterCount })}
              onAskAiForSelection={onSendSelectionToChat || onAskAiForSelection ? handleAskAiForSelection : undefined}
              onAddSelectionToChat={onAddSelectionToChat ? handleAddSelectionToChat : undefined}
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
            {reviewChangeCount > 0 ? (
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
            disabled={reviewChangeCount === 0 || !onRejectReviewChanges}
            onClick={onRejectReviewChanges}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('writing.review.rejectFile', 'Reject file')}
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={reviewChangeCount === 0 || !onAcceptReviewChanges}
            onClick={onAcceptReviewChanges}
          >
            <Check className="h-3.5 w-3.5" />
            {t('writing.review.acceptFile', 'Accept file')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
