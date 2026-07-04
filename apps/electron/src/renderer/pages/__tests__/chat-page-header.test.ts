// input: Chat page source and header action contracts
// output: Regression coverage for visible chat header controls
// pos: Keeps primary chat header actions discoverable in the Electron renderer

import { readFileSync } from 'fs'
import { describe, expect, it } from 'bun:test'

describe('chat page header actions', () => {
  it('renders the new session action with a visible text label', () => {
    const chatPageSource = readFileSync(new URL('../ChatPage.tsx', import.meta.url), 'utf-8')
    const newSessionButtonSource = chatPageSource.slice(
      chatPageSource.indexOf('const newSessionButton = React.useMemo'),
      chatPageSource.indexOf('<StyledContextMenuContent>')
    )

    expect(newSessionButtonSource).toContain('icon={(')
    expect(newSessionButtonSource).toContain('<SquarePenRounded className="h-4 w-4" />')
    expect(newSessionButtonSource).toContain(
      '<span className="text-[11px] font-medium leading-none">{t("session.newSession")}</span>'
    )
  })

  it('uses per-session loaded state instead of subscribing to the whole loaded set', () => {
    const chatPageSource = readFileSync(new URL('../ChatPage.tsx', import.meta.url), 'utf-8')
    const chatPageComponentSource = chatPageSource.slice(
      chatPageSource.indexOf('const ChatPage = React.memo'),
      chatPageSource.indexOf('export default ChatPage')
    )

    expect(chatPageSource).toContain('sessionMessagesLoadedAtomFamily')
    expect(chatPageComponentSource).toContain('useAtomValue(sessionMessagesLoadedAtomFamily(sessionId))')
    expect(chatPageComponentSource).not.toContain('useAtomValue(loadedSessionsAtom)')
  })

  it('uses per-session metadata in the root chat page instead of the whole metadata map', () => {
    const chatPageSource = readFileSync(new URL('../ChatPage.tsx', import.meta.url), 'utf-8')
    const chatPageComponentSource = chatPageSource.slice(
      chatPageSource.indexOf('const ChatPage = React.memo'),
      chatPageSource.indexOf('export default ChatPage')
    )

    expect(chatPageSource).toContain('sessionMetaAtomFamily')
    expect(chatPageComponentSource).toContain('useAtomValue(sessionMetaAtomFamily(sessionId))')
    expect(chatPageComponentSource).not.toContain('useAtomValue(sessionMetaMapAtom)')
    expect(chatPageComponentSource).not.toContain('sessionMetaMap.get(sessionId)')
  })

  it('reuses the relative time locale across conversation history rows', () => {
    const chatPageSource = readFileSync(new URL('../ChatPage.tsx', import.meta.url), 'utf-8')
    const historySource = chatPageSource.slice(
      chatPageSource.indexOf('function ConversationHistoryMenuItems'),
      chatPageSource.indexOf('const ChatPage = React.memo')
    )

    expect(historySource).toContain('const relativeTimeLocale = React.useMemo')
    expect(historySource).toContain('locale: relativeTimeLocale')
    expect(historySource).not.toContain('locale: {\n                ...getDateLocale')
  })

  it('uses the narrow session interaction action context', () => {
    const chatPageSource = readFileSync(new URL('../ChatPage.tsx', import.meta.url), 'utf-8')
    const appShellDestructure = chatPageSource.slice(
      chatPageSource.indexOf('const {'),
      chatPageSource.indexOf('} = useAppShellContext()')
    )

    expect(chatPageSource).toContain('useSessionInteractionActions')
    expect(appShellDestructure).not.toContain('onCreateSession')
    expect(appShellDestructure).not.toContain('onSendMessage')
    expect(appShellDestructure).not.toContain('onRespondToPermission')
    expect(appShellDestructure).not.toContain('onRespondToCredential')
  })
})
