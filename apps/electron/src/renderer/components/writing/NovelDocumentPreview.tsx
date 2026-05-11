// input: Selected novel workspace file and loaded Markdown content
// output: Read-only document preview with writer-facing file label
// pos: Preview companion for the legacy tabbed writing workspace

import * as React from 'react'
import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Markdown } from '@/components/markdown'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { NovelWorkspaceFile } from '@/lib/writing-workspace'
import { formatNovelWorkspaceFileTitle } from './novel-file-display'

export interface NovelDocumentPreviewProps {
  file?: NovelWorkspaceFile
  content?: string
  loading?: boolean
  onOpenFile?: (path: string) => void
}

export function NovelDocumentPreview({
  file,
  content,
  loading = false,
  onOpenFile,
}: NovelDocumentPreviewProps) {
  const { t } = useTranslation()

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
        {t('writing.emptySection')}
      </div>
    )
  }

  const displayTitle = formatNovelWorkspaceFileTitle(file, t)

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <div className="min-w-0 truncate text-xs font-medium text-foreground/80" title={file.relativePath}>
          {displayTitle}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onOpenFile?.(file.path)}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t('common.open')}
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-3xl px-6 py-5">
          {loading ? (
            <div className="text-xs text-muted-foreground">{t('fileViewer.loadingContent')}</div>
          ) : content ? (
            <Markdown>{content}</Markdown>
          ) : (
            <div className="text-xs text-muted-foreground">{t('writing.emptySection')}</div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
