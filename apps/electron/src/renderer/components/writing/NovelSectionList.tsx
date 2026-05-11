// input: Novel workspace files and selection callbacks
// output: Writer-facing document list for a single novel workspace section
// pos: Reusable file list used by writing navigator and workspace panels

import * as React from 'react'
import { FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { NovelWorkspaceFile } from '@/lib/writing-workspace'
import { formatNovelWorkspaceFileTitle } from './novel-file-display'

export interface NovelSectionListProps {
  files: NovelWorkspaceFile[]
  activePath?: string
  onSelectFile?: (file: NovelWorkspaceFile) => void
  className?: string
}

export function NovelSectionList({
  files,
  activePath,
  onSelectFile,
  className,
}: NovelSectionListProps) {
  const { t } = useTranslation()

  if (files.length === 0) {
    return (
      <div className={cn('flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground', className)}>
        {t('writing.emptySection')}
      </div>
    )
  }

  return (
    <ScrollArea className={cn('h-full', className)}>
      <div className="divide-y divide-border/50">
        {files.map((file) => {
          const isActive = file.path === activePath
          const displayTitle = formatNovelWorkspaceFileTitle(file, t)

          return (
            <button
              key={file.path}
              type="button"
              title={file.relativePath}
              onClick={() => onSelectFile?.(file)}
              className={cn(
                'flex h-9 w-full items-center gap-2 px-3 text-left text-xs transition-colors hover:bg-foreground/[0.04]',
                isActive && 'bg-foreground/[0.06] text-foreground'
              )}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{displayTitle}</span>
            </button>
          )
        })}
      </div>
    </ScrollArea>
  )
}
