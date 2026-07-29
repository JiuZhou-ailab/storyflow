// input: Open writing files, active path, start-page action, and trailing header controls
// output: Shared closable file-tab header with a workspace start-page button
// pos: Stable chrome above both the manuscript editor and optional directory pane

import * as React from 'react'
import { FileText, Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { NovelWorkspaceFile } from '@/lib/writing-workspace'
import { formatNovelWorkspaceFileTitle } from './novel-file-display'

export interface NovelDocumentTabStripProps {
  files: NovelWorkspaceFile[]
  activePath: string | null
  onActivate: (file: NovelWorkspaceFile) => void
  onClose: (path: string) => void
  onOpenStart: () => void
  trailingActions?: React.ReactNode
}

export function NovelDocumentTabStrip({
  files,
  activePath,
  onActivate,
  onClose,
  onOpenStart,
  trailingActions,
}: NovelDocumentTabStripProps) {
  const { t } = useTranslation()

  return (
    <div
      data-panel-role="writing-file-tabs"
      className="titlebar-drag-region relative z-panel flex h-[42px] shrink-0 items-stretch border-b border-foreground/[0.06] bg-background"
    >
      <div role="tablist" aria-label={t('writing.workspace')} className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {files.map((file) => {
          const title = formatNovelWorkspaceFileTitle(file, t)
          const active = file.path === activePath
          return (
            <div
              key={file.path}
              className={cn(
                'titlebar-no-drag group relative flex min-w-[112px] max-w-[200px] shrink-0 items-center border-r border-foreground/[0.06] text-xs',
                active ? 'bg-foreground/[0.045] text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.025] hover:text-foreground',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                title={file.relativePath}
                onClick={() => onActivate(file)}
                className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-3 pr-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={1.6} />
                <span className="truncate">{title}</span>
              </button>
              <button
                type="button"
                aria-label={`${t('common.close', '关闭')} ${title}`}
                onClick={(event) => {
                  event.stopPropagation()
                  onClose(file.path)
                }}
                className="mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 opacity-0 transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100 data-[active=true]:opacity-100"
                data-active={active}
              >
                <X className="h-3 w-3" strokeWidth={1.8} />
              </button>
              {active ? <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-foreground/35" /> : null}
            </div>
          )
        })}
        <button
          type="button"
          aria-label={t('chatOpening.project.emptyTitle', '从哪里开始？')}
          title={t('chatOpening.project.emptyTitle', '从哪里开始？')}
          onClick={onOpenStart}
          className="titlebar-no-drag inline-flex h-full w-10 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/[0.025] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.7} />
        </button>
      </div>
      {trailingActions ? (
        <div className="titlebar-no-drag flex shrink-0 items-center gap-1 px-2">
          {trailingActions}
        </div>
      ) : null}
    </div>
  )
}
