// input: ChatDisplay and ScrollArea source layout contracts.
// output: Regression coverage for chat transcript scroll containment.
// pos: Source-level guard for the app-shell chat panel scroll viewport.

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const chatDisplaySource = readFileSync(new URL('../ChatDisplay.tsx', import.meta.url), 'utf-8')
const chatInputZoneSource = readFileSync(new URL('../input/ChatInputZone.tsx', import.meta.url), 'utf-8')
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
    expect(chatInputZoneSource).toContain('queuedMessages?: QueuedInputMessage[]')
    expect(chatInputZoneSource).toContain('queuedMessages.length > 0')
    expect(chatInputZoneSource).toContain("t('chat.queuedBadge')")
  })
})
