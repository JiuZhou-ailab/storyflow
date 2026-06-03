// input: ChatDisplay and ScrollArea source layout contracts.
// output: Regression coverage for chat transcript scroll containment.
// pos: Source-level guard for the app-shell chat panel scroll viewport.

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const chatDisplaySource = readFileSync(new URL('../ChatDisplay.tsx', import.meta.url), 'utf-8')
const chatInputZoneSource = readFileSync(new URL('../input/ChatInputZone.tsx', import.meta.url), 'utf-8')
const freeFormInputSource = readFileSync(new URL('../input/FreeFormInput.tsx', import.meta.url), 'utf-8')
const scrollAreaSource = readFileSync(new URL('../../ui/scroll-area.tsx', import.meta.url), 'utf-8')

describe('ChatDisplay scroll layout', () => {
  it('keeps the transcript viewport explicitly scrollable inside a clipped flex area', () => {
    expect(scrollAreaSource).toContain('viewportClassName?: string')
    expect(chatDisplaySource).toContain('className="relative flex-1 min-h-0 overflow-hidden"')
    expect(chatDisplaySource).toContain('className="h-full min-h-0 overflow-hidden"')
    expect(chatDisplaySource).toContain('viewportClassName="h-full min-h-0 overflow-y-auto"')
  })

  it('renders queued user messages above the input instead of inside the transcript', () => {
    expect(chatDisplaySource).toContain('const queuedUserMessages = React.useMemo')
    expect(chatDisplaySource).toContain("message.role === 'user' && message.isQueued")
    expect(chatDisplaySource).toContain('const transcriptMessages = React.useMemo')
    expect(chatDisplaySource).toContain("!(message.role === 'user' && message.isQueued)")
    expect(chatDisplaySource).toContain('groupMessagesByTurn(transcriptMessages)')
    expect(chatDisplaySource).toContain('queuedMessages={queuedUserMessages}')
    expect(chatDisplaySource).toContain('forceQueuePreview: session?.isProcessing === true')
    expect(chatInputZoneSource).toContain('queuedMessages?: QueuedInputMessage[]')
    expect(chatInputZoneSource).toContain('queuedMessages.length > 0')
    expect(chatInputZoneSource).toContain("t('chat.queuedBadge')")
  })

  it('wires queued message previews to the send-now interruption command', () => {
    expect(chatInputZoneSource).toContain('onSendQueuedMessageNow?: (messageId: string) => void')
    expect(chatInputZoneSource).toContain("t('chat.sendQueuedNow')")
    expect(chatInputZoneSource).toContain('onSendQueuedMessageNow?.(message.id)')
    expect(chatDisplaySource).toContain("type: 'sendQueuedMessageNow'")
    expect(chatDisplaySource).toContain('onSendQueuedMessageNow={handleSendQueuedMessageNow}')
  })

  it('wires queued message previews to edit and delete actions', () => {
    expect(chatInputZoneSource).toContain('onEditQueuedMessage?: (message: QueuedInputMessage) => void')
    expect(chatInputZoneSource).toContain('onRemoveQueuedMessage?: (messageId: string) => void')
    expect(chatInputZoneSource).toContain('onEditQueuedMessage?.(message)')
    expect(chatInputZoneSource).toContain('onRemoveQueuedMessage?.(message.id)')
    expect(chatDisplaySource).toContain("type: 'removeQueuedMessage'")
    expect(chatDisplaySource).toContain('onEditQueuedMessage={handleEditQueuedMessage}')
    expect(chatDisplaySource).toContain('onRemoveQueuedMessage={handleRemoveQueuedMessage}')
  })

  it('keeps the composer toolbar actions visible in narrow side panels', () => {
    expect(freeFormInputSource).toContain('flex min-w-0 items-center gap-1 px-2 py-2')
    expect(freeFormInputSource).toContain('flex min-w-0 flex-1 items-center gap-1 overflow-hidden')
    expect(freeFormInputSource).toContain('flex min-w-0 max-w-[52%] items-center justify-end shrink-0')
    expect(freeFormInputSource).toContain('inline-flex min-w-0 max-w-[140px] items-center h-7')
    expect(freeFormInputSource).toContain('<span className="min-w-0 truncate">{currentModelDisplayName}</span>')
  })
})
