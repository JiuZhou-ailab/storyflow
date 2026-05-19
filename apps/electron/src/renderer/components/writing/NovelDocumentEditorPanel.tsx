// input: Selected novel workspace file content, review changes, and save/open callbacks
// output: Middle-column Markdown document editor or inline review surface
// pos: Replaces the session-list navigator column for novel writing workspaces

import * as React from 'react'
import { AlertCircle, Check, ChevronLeft, ChevronRight, GitPullRequestArrow, Loader2, RotateCcw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useTranslation } from 'react-i18next'
import remarkGfm from 'remark-gfm'
import type { FileChange } from '@craft-agent/ui'
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

interface NovelReviewParts {
  before: string
  original: string
  modified: string
  after: string
}

const NOVEL_INLINE_REVIEW_TOKEN = '\uE000craft-novel-review-change\uE001'
const NOVEL_REVIEW_DELETED_CLASS = 'novel-review-deleted rounded-[3px] bg-destructive/[0.075] px-0.5 text-destructive/85 decoration-destructive/55 decoration-1 leading-[inherit]'
const NOVEL_REVIEW_INSERTED_CLASS = 'novel-review-inserted rounded-[3px] bg-emerald-500/[0.13] px-0.5 text-emerald-950 no-underline dark:text-emerald-100 leading-[inherit]'

interface MarkdownAstNode {
  type: string
  value?: string
  children?: MarkdownAstNode[]
  data?: {
    hName?: string
    hProperties?: Record<string, unknown>
  }
}

function extractUnifiedDiffReviewText(unifiedDiff: string): Pick<NovelReviewParts, 'original' | 'modified'> | null {
  const originalLines: string[] = []
  const modifiedLines: string[] = []

  for (const line of unifiedDiff.split('\n')) {
    if (!line) continue
    if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('@@')) continue
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('\\')) continue

    if (line.startsWith('-')) {
      originalLines.push(line.slice(1))
      continue
    }

    if (line.startsWith('+')) {
      modifiedLines.push(line.slice(1))
    }
  }

  const modified = modifiedLines.join('\n')
  if (!modified) return null

  return {
    original: originalLines.join('\n'),
    modified,
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0

  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

function isInlineReviewSafe(text: string): boolean {
  return !/[\r\n]/.test(text)
}

function buildNovelReviewParts(
  content: string,
  change?: FileChange,
): NovelReviewParts | null {
  if (!change || change.error) return null
  if (content.includes(NOVEL_INLINE_REVIEW_TOKEN)) return null

  const reviewText = change.unifiedDiff
    ? extractUnifiedDiffReviewText(change.unifiedDiff)
    : {
        original: change.original,
        modified: change.modified,
      }
  if (!reviewText?.modified) return null
  if (countOccurrences(content, reviewText.modified) !== 1) return null

  const index = content.indexOf(reviewText.modified)
  return {
    before: content.slice(0, index),
    original: reviewText.original,
    modified: reviewText.modified,
    after: content.slice(index + reviewText.modified.length),
  }
}

export function buildNovelInlineReviewParts(
  content: string,
  change?: FileChange,
): NovelReviewParts | null {
  const parts = buildNovelReviewParts(content, change)
  if (!parts) return null
  if (!isInlineReviewSafe(parts.original) || !isInlineReviewSafe(parts.modified)) return null
  return parts
}

function createReviewTextNode(value: string): MarkdownAstNode {
  return {
    type: 'text',
    value,
  }
}

function createReviewInlineNode(tagName: 'del' | 'ins', className: string, value: string): MarkdownAstNode {
  return {
    type: 'strong',
    data: {
      hName: tagName,
      hProperties: {
        className,
      },
    },
    children: [createReviewTextNode(value)],
  }
}

function createReviewReplacementNodes(parts: NovelReviewParts): MarkdownAstNode[] {
  return [
    ...(parts.original
      ? [createReviewInlineNode('del', NOVEL_REVIEW_DELETED_CLASS, parts.original)]
      : []),
    createReviewInlineNode('ins', NOVEL_REVIEW_INSERTED_CLASS, parts.modified),
  ]
}

function replaceReviewToken(node: MarkdownAstNode, parts: NovelReviewParts): void {
  if (!node.children) return

  const nextChildren: MarkdownAstNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string' && child.value.includes(NOVEL_INLINE_REVIEW_TOKEN)) {
      const segments = child.value.split(NOVEL_INLINE_REVIEW_TOKEN)
      segments.forEach((segment, index) => {
        if (segment) nextChildren.push(createReviewTextNode(segment))
        if (index < segments.length - 1) {
          nextChildren.push(...createReviewReplacementNodes(parts))
        }
      })
      continue
    }

    replaceReviewToken(child, parts)
    nextChildren.push(child)
  }

  node.children = nextChildren
}

function createNovelInlineReviewPlugin(parts: NovelReviewParts) {
  return () => (tree: MarkdownAstNode) => {
    replaceReviewToken(tree, parts)
  }
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
  const reviewParts = React.useMemo(
    () => buildNovelReviewParts(content, reviewChange),
    [content, reviewChange]
  )
  const inlineReviewParts = React.useMemo(
    () => {
      if (!reviewParts) return null
      if (!isInlineReviewSafe(reviewParts.original) || !isInlineReviewSafe(reviewParts.modified)) return null
      return reviewParts
    },
    [reviewParts]
  )

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
            {inlineReviewParts ? (
              <NovelInlineReviewDocument
                parts={inlineReviewParts}
                characterCountLabel={t('writing.totalCharacters', 'Total {{count}} characters', { count: characterCount })}
              />
            ) : reviewParts ? (
              <NovelRenderedReviewDocument
                parts={reviewParts}
                characterCountLabel={t('writing.totalCharacters', 'Total {{count}} characters', { count: characterCount })}
              />
            ) : (
              <TiptapMarkdownEditor
                content={content}
                onUpdate={onChange}
                placeholder={t('writing.emptySection')}
                editable
                markdownEngine="official"
                showToolbar
                surface="manuscript"
                showLineNumbers
                bottomRightAccessory={t('writing.totalCharacters', 'Total {{count}} characters', { count: characterCount })}
                onAskAiForSelection={onAskAiForSelection}
                className="min-h-0 flex-1"
              />
            )}
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

function NovelRenderedReviewDocument({
  parts,
  characterCountLabel,
}: {
  parts: NovelReviewParts
  characterCountLabel: string
}) {
  return (
    <div
      className="tiptap-editor tiptap-editor--manuscript tiptap-editor--line-numbers flex min-h-0 flex-1 flex-col"
      data-testid="novel-rendered-review-document"
    >
      <div className="tiptap-editor-content min-h-0 flex-1 overflow-auto">
        <article
          className="tiptap-prose novel-review-change"
          data-testid="novel-rendered-review-change"
        >
          <MarkdownReviewChunk markdown={parts.before} />
          {parts.original ? (
            <MarkdownReviewChunk
              markdown={parts.original}
              className={NOVEL_REVIEW_DELETED_CLASS}
            />
          ) : null}
          <MarkdownReviewChunk
            markdown={parts.modified}
            className={NOVEL_REVIEW_INSERTED_CLASS}
          />
          <MarkdownReviewChunk markdown={parts.after} />
        </article>
      </div>
      <div className="tiptap-editor-status-badge">
        {characterCountLabel}
      </div>
    </div>
  )
}

function MarkdownReviewChunk({
  markdown,
  className,
}: {
  markdown: string
  className?: string
}) {
  if (!markdown) return null

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

function NovelInlineReviewDocument({
  parts,
  characterCountLabel,
}: {
  parts: NovelReviewParts
  characterCountLabel: string
}) {
  const reviewMarkdown = React.useMemo(
    () => `${parts.before}${NOVEL_INLINE_REVIEW_TOKEN}${parts.after}`,
    [parts.after, parts.before]
  )
  const remarkPlugins = React.useMemo(
    () => [remarkGfm, createNovelInlineReviewPlugin(parts)],
    [parts]
  )

  return (
    <div
      className="tiptap-editor tiptap-editor--manuscript tiptap-editor--line-numbers flex min-h-0 flex-1 flex-col"
      data-testid="novel-inline-review-document"
    >
      <div className="tiptap-editor-content min-h-0 flex-1 overflow-auto">
        <article
          className="tiptap-prose novel-review-change"
          data-testid="novel-inline-review-change"
        >
          <ReactMarkdown remarkPlugins={remarkPlugins}>
            {reviewMarkdown}
          </ReactMarkdown>
        </article>
      </div>
      <div className="tiptap-editor-status-badge">
        {characterCountLabel}
      </div>
    </div>
  )
}
