import { useTranslation } from 'react-i18next'
import { DocumentFormattedMarkdownOverlay, Markdown, type TurnDetailsPart } from '@craft-agent/ui'
import { TURN_COMMENTARY_SUMMARY_BATCH_SIZE } from '@craft-agent/shared/protocol'

export async function loadTurnCommentarySummaries(
  sessionId: string,
  messageIds: string[],
): Promise<Map<string, string>> {
  const summaries = new Map<string, string>()
  for (let start = 0; start < messageIds.length; start += TURN_COMMENTARY_SUMMARY_BATCH_SIZE) {
    const result = await window.electronAPI.sessionCommand(sessionId, {
      type: 'summarizeTurnCommentary',
      messageIds: messageIds.slice(start, start + TURN_COMMENTARY_SUMMARY_BATCH_SIZE),
    }).catch(() => undefined)
    if (result && 'commentarySummaries' in result) {
      for (const { messageId, summary } of result.commentarySummaries) summaries.set(messageId, summary)
    }
  }
  return summaries
}

interface TurnDetailsOverlayProps {
  details: { parts: TurnDetailsPart[]; markdown: string }
  summaries: ReadonlyMap<string, string> | null
  onClose: () => void
  onOpenUrl: (url: string) => void
  onOpenFile: (path: string) => void
}

export function TurnDetailsOverlay({ details, summaries, onClose, onOpenUrl, onOpenFile }: TurnDetailsOverlayProps) {
  const { t } = useTranslation()

  return (
    <DocumentFormattedMarkdownOverlay
      isOpen
      accessibleTitle={t('chat.viewTurnDetails')}
      onClose={onClose}
      content={details.markdown}
    >
      <div className="space-y-3">
        {details.parts.map((part, index) => {
          const content = (
            <Markdown mode="minimal" onUrlClick={onOpenUrl} onFileClick={onOpenFile} hideFirstMermaidExpand={false}>
              {part.content}
            </Markdown>
          )
          if (part.type === 'markdown') return <div key={index}>{content}</div>

          const summary = summaries?.get(part.id) ?? (
            summaries === null && !part.pending && part.content.trim()
              ? t('chat.commentarySummaryLoading')
              : t('chat.commentarySummaryUnavailable')
          )
          return (
            <details key={part.id} className="rounded-md border border-border/40 px-3 py-2">
              <summary className="cursor-pointer list-inside truncate font-medium">{summary}</summary>
              <div className="pt-2">{content}</div>
            </details>
          )
        })}
      </div>
    </DocumentFormattedMarkdownOverlay>
  )
}
