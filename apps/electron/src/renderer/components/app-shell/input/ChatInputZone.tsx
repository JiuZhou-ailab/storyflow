import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CHAT_LAYOUT } from '@/config/layout'
import { flattenLabels, type LabelConfig } from '@craft-agent/shared/labels'
import type { PermissionMode } from '@craft-agent/shared/agent/modes'
import type { Message } from '../../../../shared/types'
import type { SessionStatus } from '@/config/session-status-config'
import type { BackgroundTask } from '../ActiveTasksBar'
import { ActiveOptionBadges } from '../ActiveOptionBadges'
import { InputContainer } from './InputContainer'
import { InputErrorBoundary } from './InputErrorBoundary'

export type QueuedInputMessage = Pick<Message, 'id' | 'content' | 'attachments'>

interface ChatInputZoneProps {
  compactMode?: boolean
  showOptionBadges?: boolean
  permissionMode?: PermissionMode
  onPermissionModeChange?: (mode: PermissionMode) => void
  tasks?: BackgroundTask[]
  sessionId: string
  sessionFolderPath?: string
  onKillTask?: (taskId: string) => void
  onInsertMessage?: (text: string) => void
  sessionLabels?: string[]
  labels?: LabelConfig[]
  onLabelsChange?: (labels: string[]) => void
  sessionStatuses?: SessionStatus[]
  currentSessionStatus?: string
  onSessionStatusChange?: (stateId: string) => void
  queuedMessages?: QueuedInputMessage[]
  onSendQueuedMessageNow?: (messageId: string) => void
  onEditQueuedMessage?: (message: QueuedInputMessage) => void
  onRemoveQueuedMessage?: (messageId: string) => void
  className?: string
  inputProps: React.ComponentProps<typeof InputContainer>
}

export function ChatInputZone({
  compactMode = false,
  showOptionBadges,
  permissionMode = 'ask',
  onPermissionModeChange,
  tasks = [],
  sessionId,
  sessionFolderPath,
  onKillTask,
  onInsertMessage,
  sessionLabels = [],
  labels = [],
  onLabelsChange,
  sessionStatuses = [],
  currentSessionStatus = 'todo',
  onSessionStatusChange,
  queuedMessages = [],
  onSendQueuedMessageNow,
  onEditQueuedMessage,
  onRemoveQueuedMessage,
  className,
  inputProps,
}: ChatInputZoneProps) {
  const { t } = useTranslation()
  const [autoOpenLabelId, setAutoOpenLabelId] = React.useState<string | null>(null)
  const queuedCount = queuedMessages.length
  const shouldShowOptionBadges = showOptionBadges ?? !compactMode
  const inputResetKey = `${sessionId}::${inputProps.structuredInput?.type ?? 'freeform'}`

  const handleClearDraft = React.useCallback(() => {
    inputProps.onInputChange?.('')
    inputProps.onAttachmentsChange?.([])
  }, [inputProps])

  const handleLabelAdd = React.useCallback((labelId: string) => {
    const current = sessionLabels || []
    if (current.includes(labelId)) return

    onLabelsChange?.([...current, labelId])

    const config = flattenLabels(labels || []).find(label => label.id === labelId)
    if (config?.valueType) {
      setAutoOpenLabelId(labelId)
    }
  }, [labels, onLabelsChange, sessionLabels])

  return (
    <div className={cn(
      CHAT_LAYOUT.maxWidth,
      'mx-auto w-full mt-1',
      compactMode ? 'px-2 pb-3' : 'px-3 @xs/panel:px-4 pb-4',
      className,
    )}>
      {shouldShowOptionBadges && (
        <ActiveOptionBadges
          permissionMode={permissionMode}
          onPermissionModeChange={onPermissionModeChange}
          tasks={tasks}
          sessionId={sessionId}
          sessionFolderPath={sessionFolderPath}
          onKillTask={onKillTask}
          onInsertMessage={onInsertMessage ?? inputProps.onInputChange}
          sessionLabels={sessionLabels}
          labels={labels}
          onLabelsChange={onLabelsChange}
          onRemoveLabel={(labelId) => {
            const next = (sessionLabels || []).filter(entry => entry !== labelId && !entry.startsWith(`${labelId}::`))
            onLabelsChange?.(next)
          }}
          autoOpenLabelId={autoOpenLabelId}
          onAutoOpenConsumed={() => setAutoOpenLabelId(null)}
          sessionStatuses={sessionStatuses}
          currentSessionStatus={currentSessionStatus}
          onSessionStatusChange={onSessionStatusChange}
        />
      )}

      {queuedMessages.length > 0 && (
        <div
          className="mb-1.5 overflow-hidden rounded-[10px] border border-border/45 bg-background/90 px-3 py-2 shadow-minimal"
          role="status"
          aria-live="polite"
        >
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Clock className="h-3 w-3 animate-pulse" aria-hidden="true" />
            <span>{t('chat.queuedBadge')}</span>
            {queuedCount > 1 && <span className="text-muted-foreground/60">× {queuedCount}</span>}
          </div>
          <div className="max-h-24 space-y-1 overflow-y-auto">
            {queuedMessages.map((message) => (
              (() => {
                const text = message.content.trim()
                const fallback = message.attachments?.length
                  ? t('chat.filesCount', { count: message.attachments.length })
                  : t('chat.queuedBadge')
                const label = text || fallback

                return (
                  <div
                    key={message.id}
                    className="flex min-w-0 items-center gap-2 rounded-[6px] bg-foreground/[0.035] px-2 py-1 text-xs text-foreground/75"
                    title={label}
                  >
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {onSendQueuedMessageNow && (
                      <button
                        type="button"
                        className="shrink-0 rounded-[5px] px-1.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 hover:text-primary"
                        aria-label={t('chat.sendQueuedNow')}
                        onClick={() => onSendQueuedMessageNow?.(message.id)}
                      >
                        {t('chat.sendQueuedNow')}
                      </button>
                    )}
                    {onEditQueuedMessage && (
                      <button
                        type="button"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                        aria-label={t('chat.editQueuedMessage')}
                        title={t('chat.editQueuedMessage')}
                        onClick={() => onEditQueuedMessage?.(message)}
                      >
                        <Pencil className="h-3 w-3" aria-hidden="true" />
                      </button>
                    )}
                    {onRemoveQueuedMessage && (
                      <button
                        type="button"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        aria-label={t('chat.removeQueuedMessage')}
                        title={t('chat.removeQueuedMessage')}
                        onClick={() => onRemoveQueuedMessage?.(message.id)}
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                )
              })()
            ))}
          </div>
        </div>
      )}

      <InputErrorBoundary
        sessionId={sessionId}
        resetKey={inputResetKey}
        onClearDraft={handleClearDraft}
      >
        <InputContainer
          {...inputProps}
          compactMode={compactMode}
          permissionMode={permissionMode}
          onPermissionModeChange={onPermissionModeChange}
          labels={labels}
          sessionLabels={sessionLabels}
          onLabelAdd={handleLabelAdd}
          sessionFolderPath={sessionFolderPath}
          sessionId={sessionId}
          currentSessionStatus={currentSessionStatus}
        />
      </InputErrorBoundary>
    </div>
  )
}
