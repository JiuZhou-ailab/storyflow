// input: Chat page source and header action contracts
// output: Regression coverage for visible chat header controls
// pos: Keeps primary chat header actions discoverable in the Electron renderer

import { readFileSync } from 'fs'
import { describe, expect, it } from 'bun:test'

describe('chat page header actions', () => {
  const appShellDestructureFrom = (source: string) => {
    const end = source.indexOf('} = useAppShellContext()')
    return source.slice(source.lastIndexOf('const {', end), end)
  }

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
    const appShellDestructure = appShellDestructureFrom(chatPageSource)

    expect(chatPageSource).toContain('useSessionInteractionActions')
    expect(appShellDestructure).not.toContain('onCreateSession')
    expect(appShellDestructure).not.toContain('onSendMessage')
    expect(appShellDestructure).not.toContain('onRespondToPermission')
    expect(appShellDestructure).not.toContain('onRespondToCredential')
  })

  it('uses the narrow session batch action context', () => {
    const chatPageSource = readFileSync(new URL('../ChatPage.tsx', import.meta.url), 'utf-8')
    const appShellDestructure = appShellDestructureFrom(chatPageSource)

    expect(chatPageSource).toContain('useSessionBatchActions')
    expect(appShellDestructure).not.toContain('labels')
    expect(appShellDestructure).not.toContain('sessionStatuses')
    expect(appShellDestructure).not.toContain('onSessionLabelsChange')
    expect(appShellDestructure).not.toContain('onArchiveSession')
    expect(appShellDestructure).not.toContain('onSessionStatusChange')
  })

  it('uses the narrow session batch context for menu mutation actions', () => {
    const chatPageSource = readFileSync(new URL('../ChatPage.tsx', import.meta.url), 'utf-8')
    const appShellDestructure = appShellDestructureFrom(chatPageSource)

    expect(chatPageSource).toContain('useSessionBatchActions')
    expect(appShellDestructure).not.toContain('onRenameSession')
    expect(appShellDestructure).not.toContain('onFlagSession')
    expect(appShellDestructure).not.toContain('onUnflagSession')
    expect(appShellDestructure).not.toContain('onUnarchiveSession')
    expect(appShellDestructure).not.toContain('onDeleteSession')
  })

  it('uses workspace atoms instead of app shell workspace fields', () => {
    const chatPageSource = readFileSync(new URL('../ChatPage.tsx', import.meta.url), 'utf-8')
    const appShellDestructure = appShellDestructureFrom(chatPageSource)

    expect(chatPageSource).toContain('useActiveWorkspace')
    expect(chatPageSource).toContain('windowWorkspaceIdAtom')
    expect(appShellDestructure).not.toContain('activeWorkspaceId')
    expect(appShellDestructure).not.toContain('workspaces')
  })

  it('uses LLM connection atoms instead of app shell fields', () => {
    const chatPageSource = readFileSync(new URL('../ChatPage.tsx', import.meta.url), 'utf-8')
    const appShellDestructure = appShellDestructureFrom(chatPageSource)

    expect(chatPageSource).toContain('llmConnectionsAtom')
    expect(chatPageSource).toContain('workspaceDefaultLlmConnectionAtom')
    expect(chatPageSource).toContain('refreshLlmConnectionsAtom')
    expect(appShellDestructure).not.toContain('llmConnections')
    expect(appShellDestructure).not.toContain('workspaceDefaultLlmConnection')
    expect(appShellDestructure).not.toContain('refreshLlmConnections')
  })

  it('uses platform actions instead of app shell file and URL handlers', () => {
    const chatPageSource = readFileSync(new URL('../ChatPage.tsx', import.meta.url), 'utf-8')
    const appShellDestructure = appShellDestructureFrom(chatPageSource)

    expect(chatPageSource).toContain('usePlatform')
    expect(appShellDestructure).not.toContain('onOpenFile')
    expect(appShellDestructure).not.toContain('onOpenUrl')
  })

  it('uses the narrow session read action context', () => {
    const chatPageSource = readFileSync(new URL('../ChatPage.tsx', import.meta.url), 'utf-8')
    const appShellDestructure = appShellDestructureFrom(chatPageSource)

    expect(chatPageSource).toContain('useSessionReadActions')
    expect(appShellDestructure).not.toContain('onMarkSessionRead')
    expect(appShellDestructure).not.toContain('onMarkSessionUnread')
    expect(appShellDestructure).not.toContain('onSetActiveViewingSession')
  })

  it('uses the narrow session draft action context', () => {
    const chatPageSource = readFileSync(new URL('../ChatPage.tsx', import.meta.url), 'utf-8')
    const appShellDestructure = appShellDestructureFrom(chatPageSource)

    expect(chatPageSource).toContain('useSessionDraftActions')
    expect(appShellDestructure).not.toContain('getDraft')
    expect(appShellDestructure).not.toContain('hydrateDraftAttachments')
    expect(appShellDestructure).not.toContain('onInputChange')
    expect(appShellDestructure).not.toContain('onAttachmentsChange')
  })
})
