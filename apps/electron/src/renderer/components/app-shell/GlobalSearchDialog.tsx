// input: Workspace session metadata, writing files, and open callbacks
// output: Command-style global search dialog for sessions and writing documents
// pos: Top-bar search surface for cross-workspace navigation inside the app shell

import * as React from 'react'
import { FileText, MessageSquareText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SessionMeta } from '@/atoms/sessions'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { buildGlobalSearchResults } from '@/lib/global-search'
import type { NovelWorkspaceFile } from '@/lib/writing-workspace'
import { cn } from '@/lib/utils'

export interface GlobalSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId?: string
  sessions: SessionMeta[]
  novelFiles: NovelWorkspaceFile[]
  formatNovelFileTitle: (file: NovelWorkspaceFile) => string
  onOpenSession: (sessionId: string) => void
  onOpenNovelFile: (file: NovelWorkspaceFile) => void
}

export function GlobalSearchDialog({
  open,
  onOpenChange,
  workspaceId,
  sessions,
  novelFiles,
  formatNovelFileTitle,
  onOpenSession,
  onOpenNovelFile,
}: GlobalSearchDialogProps) {
  const { t } = useTranslation()
  const [query, setQuery] = React.useState('')
  const [contentResults, setContentResults] = React.useState<Map<string, { matchCount: number; snippet: string }>>(new Map())
  const [searchingContent, setSearchingContent] = React.useState(false)

  React.useEffect(() => {
    if (!open) {
      setQuery('')
      setContentResults(new Map())
      setSearchingContent(false)
    }
  }, [open])

  React.useEffect(() => {
    const trimmedQuery = query.trim()
    if (!open || !workspaceId || trimmedQuery.length < 2) {
      setContentResults(new Map())
      setSearchingContent(false)
      return
    }

    let cancelled = false
    const searchId = `global-${Date.now().toString(36)}`
    setSearchingContent(true)

    const timer = window.setTimeout(async () => {
      try {
        const results = await window.electronAPI.searchSessionContent(workspaceId, trimmedQuery, searchId)
        if (cancelled) return

        setContentResults(new Map(results.map(result => [
          result.sessionId,
          {
            matchCount: result.matchCount,
            snippet: result.matches[0]?.snippet || '',
          },
        ])))
      } catch {
        if (!cancelled) setContentResults(new Map())
      } finally {
        if (!cancelled) setSearchingContent(false)
      }
    }, 100)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      setSearchingContent(false)
    }
  }, [open, query, workspaceId])

  const results = React.useMemo(
    () => buildGlobalSearchResults({
      query,
      sessions,
      novelFiles,
      sessionContentResults: contentResults,
      formatNovelFileTitle,
    }),
    [contentResults, formatNovelFileTitle, novelFiles, query, sessions]
  )

  const hasQuery = query.trim().length >= 2
  const hasResults = results.sessions.length > 0 || results.files.length > 0

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={t('globalSearch.placeholder', 'Search sessions and writing files...')}
      />
      <CommandList className="max-h-[min(520px,70vh)]">
        {!hasQuery ? (
          <CommandEmpty className="py-8 text-xs text-muted-foreground">
            {t('globalSearch.hint', 'Type at least 2 characters to search.')}
          </CommandEmpty>
        ) : !hasResults ? (
          <CommandEmpty className="py-8 text-xs text-muted-foreground">
            {t('globalSearch.empty', 'No results found.')}
          </CommandEmpty>
        ) : null}

        {results.sessions.length > 0 ? (
          <CommandGroup heading={t('globalSearch.sessions', 'Sessions')}>
            {results.sessions.map(({ session, title, preview, matchCount }) => (
              <CommandItem
                key={`session:${session.id}`}
                value={`session:${session.id}:${title}:${preview ?? ''}`}
                onSelect={() => {
                  onOpenChange(false)
                  onOpenSession(session.id)
                }}
                className="items-start gap-3 rounded-[6px] px-2.5 py-2"
              >
                <SearchResultIcon>
                  <MessageSquareText className="h-4 w-4" />
                </SearchResultIcon>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{title}</div>
                  {preview ? (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{preview}</div>
                  ) : null}
                </div>
                {matchCount ? (
                  <span className="mt-1 shrink-0 rounded-[4px] bg-foreground/[0.05] px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {matchCount}
                  </span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {results.files.length > 0 ? (
          <CommandGroup heading={t('globalSearch.writingFiles', 'Writing files')}>
            {results.files.map(({ file, title }) => (
              <CommandItem
                key={`file:${file.path}`}
                value={`file:${file.path}:${title}:${file.relativePath}`}
                onSelect={() => {
                  onOpenChange(false)
                  onOpenNovelFile(file)
                }}
                className="items-start gap-3 rounded-[6px] px-2.5 py-2"
              >
                <SearchResultIcon>
                  <FileText className="h-4 w-4" />
                </SearchResultIcon>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{title}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{file.relativePath}</div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
          ) : null}

        {searchingContent ? (
          <div className="border-t border-border/50 px-3 py-2 text-[11px] text-muted-foreground">
            {t('globalSearch.searchingContent', 'Searching session content...')}
          </div>
        ) : null}
      </CommandList>
    </CommandDialog>
  )
}

function SearchResultIcon({ children }: { children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px]',
        'bg-foreground/[0.04] text-muted-foreground'
      )}
    >
      {children}
    </span>
  )
}
