// input: Source text, edit capability and an optional source Search Hit
// output: Plain text input with a non-copyable line gutter and source selection
// pos: File view only; content ownership and persistence belong to its caller
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { locateSourceSearch, type DocumentSearchTarget } from '@craft-agent/ui'

export function TextSource({ content, onChange, searchTarget, label }: {
  content: string
  onChange?: (content: string) => void
  searchTarget?: DocumentSearchTarget
  label: string
}) {
  const { t } = useTranslation()
  const input = useRef<HTMLTextAreaElement>(null)
  const gutter = useRef<HTMLPreElement>(null)
  const location = useMemo(() => searchTarget ? locateSourceSearch(content, searchTarget) : null, [content, searchTarget])
  const locatedRequest = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!searchTarget || locatedRequest.current === searchTarget.requestId) return
    if (!input.current || location?.from === undefined || location.to === undefined) return
    locatedRequest.current = searchTarget.requestId
    input.current.focus()
    input.current.setSelectionRange(location.from, location.to)
    const row = content.slice(0, location.from).split('\n').length - 1
    input.current.scrollTop = Math.max(0, row * 24 - input.current.clientHeight / 2)
    if (gutter.current) gutter.current.scrollTop = input.current.scrollTop
  }, [searchTarget?.requestId, location])
  return <div className="flex h-full min-h-0 flex-col" data-document-search-state={location?.status}>
    {location && location.status !== 'located' && <div role="status" className="px-3 py-1 text-xs text-muted-foreground">{t(`globalSearch.location.${location.status}`)}</div>}
    <div className="flex min-h-0 flex-1 font-mono text-sm leading-6">
      <pre ref={gutter} aria-hidden="true" className="select-none overflow-hidden border-r border-border/40 px-3 py-3 text-right text-muted-foreground">{Array.from({ length: content.split('\n').length }, (_, i) => i + 1).join('\n')}</pre>
      <textarea ref={input} data-testid="text-source" aria-label={label} value={content}
        readOnly={!onChange} onChange={event => onChange?.(event.target.value)}
        onScroll={event => { if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop }}
        spellCheck={false} autoCorrect="off" autoCapitalize="off" wrap="off"
        className="min-w-0 flex-1 resize-none overflow-auto bg-transparent p-3 font-mono text-sm leading-6 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring" />
    </div>
  </div>
}
