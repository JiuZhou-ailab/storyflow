// input: Chat page, activity rail, and shared session menu source contracts
// output: Regression coverage for minimal chat header controls
// pos: Keeps duplicate session navigation out of the Electron chat header

import { readFileSync } from 'fs'
import { describe, expect, it } from 'bun:test'

describe('chat page header actions', () => {
  const appShellDestructureFrom = (source: string) => {
    const end = source.indexOf('} = useAppShellContext()')
    if (end === -1) return ''
    return source.slice(source.lastIndexOf('const {', end), end)
  }

  it('leaves navigation and sharing to the activity rail and session menu', () => {
    const chatPageSource = readFileSync(new URL('../ChatPage.tsx', import.meta.url), 'utf-8')
    const activityRailSource = readFileSync(new URL('../../components/app-shell/ActivityRail.tsx', import.meta.url), 'utf-8')
    const sessionMenuSource = readFileSync(new URL('../../components/app-shell/SessionMenu.tsx', import.meta.url), 'utf-8')

    expect(chatPageSource).not.toContain('newSessionButton')
    expect(chatPageSource).not.toContain('ConversationHistoryMenu')
    expect(chatPageSource).not.toContain('shareButton')
    expect(chatPageSource).toContain('const headerActions = isCompactMode ? compactInfoButton : undefined')
    expect(chatPageSource).toContain('<SessionMenu')
    expect(activityRailSource).toContain('aria-label="新建任务"')
    expect(activityRailSource).toContain('onCreateConversation={onCreateConversationInProject')
    expect(sessionMenuSource).toContain('<ShareMenuItems sessionId={sessionId}')
  })

  it('places chat titles at the leading edge with an independent menu trigger', () => {
    const chatPageSource = readFileSync(new URL('../ChatPage.tsx', import.meta.url), 'utf-8')
    const panelHeaderSource = readFileSync(new URL('../../components/app-shell/PanelHeader.tsx', import.meta.url), 'utf-8')

    expect(chatPageSource.match(/titleAlign="start"/g)).toHaveLength(3)
    expect(panelHeaderSource).toContain("titleAlign?: 'start' | 'center'")
    expect(panelHeaderSource).toContain("titleAlign === 'start'")
    expect(panelHeaderSource).toContain('<MoreHorizontal')
    expect(panelHeaderSource).not.toContain('onClick={() => setDropdownOpen(true)}')
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

  it('uses the resolved runtime workspace instead of independently reconstructing workspace state', () => {
    const chatPageSource = readFileSync(new URL('../ChatPage.tsx', import.meta.url), 'utf-8')
    const chatPageComponentSource = chatPageSource.slice(
      chatPageSource.indexOf('const ChatPage = React.memo'),
      chatPageSource.indexOf('export default ChatPage')
    )

    expect(chatPageComponentSource).toContain('runtimeWorkspace,')
    expect(chatPageComponentSource).toContain('const activeWorkspaceId = runtimeWorkspace?.id ?? null')
    expect(chatPageComponentSource).toContain('const chatWorkspace = runtimeWorkspace')
    expect(chatPageComponentSource).not.toContain('workspacePanelFieldsAtomFamily')
    expect(chatPageComponentSource).not.toContain('useActiveWorkspace()')
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

  it('gets workspace identity from the narrow session resources context', () => {
    const chatPageSource = readFileSync(new URL('../ChatPage.tsx', import.meta.url), 'utf-8')
    const appShellDestructure = appShellDestructureFrom(chatPageSource)

    expect(chatPageSource).toContain('useSessionChatResources')
    expect(chatPageSource).toContain('const activeWorkspaceId = runtimeWorkspace?.id ?? null')
    expect(chatPageSource).not.toContain('windowWorkspaceIdAtom')
    expect(chatPageSource).not.toContain('workspacePanelFieldsAtomFamily')
    expect(chatPageSource).not.toContain('useActiveWorkspace')
    expect(appShellDestructure).not.toContain('activeWorkspaceId')
    expect(appShellDestructure).not.toContain('workspaces')
  })

  it('keeps the project directory and execution mode on one row above the input', () => {
    const chatInputZoneSource = readFileSync(new URL('../../components/app-shell/input/ChatInputZone.tsx', import.meta.url), 'utf-8')
    const freeFormInputSource = readFileSync(new URL('../../components/app-shell/input/FreeFormInput.tsx', import.meta.url), 'utf-8')
    const appShellContextSource = readFileSync(new URL('../../context/AppShellContext.tsx', import.meta.url), 'utf-8')
    const desktopToolbar = freeFormInputSource.slice(
      freeFormInputSource.indexOf('{/* Desktop: attachment and source controls */}'),
      freeFormInputSource.indexOf('{/* Spacer */}'),
    )

    expect(chatInputZoneSource).toContain('useSessionChatResources')
    expect(chatInputZoneSource).toContain('runtimeWorkspace.id !== FREE_CONVERSATION_WORKSPACE_ID')
    expect(chatInputZoneSource).toContain('onOpenFreeConversations({ createNew: true })')
    expect(chatInputZoneSource).toContain('data-testid="chat-workspace-context"')
    expect(chatInputZoneSource).toContain('<WorkingDirectoryBadge')
    expect(chatInputZoneSource).toContain('leadingContent=')
    expect(chatInputZoneSource).toContain('inputProps.isEmptySession &&')
    expect(desktopToolbar).not.toContain('<WorkingDirectoryBadge')
    expect(appShellContextSource).toContain("onOpenFreeConversations: AppShellContextType['onOpenFreeConversations']")
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

  it('uses the narrow session chat resources context', () => {
    const chatPageSource = readFileSync(new URL('../ChatPage.tsx', import.meta.url), 'utf-8')
    const appShellDestructure = appShellDestructureFrom(chatPageSource)

    expect(chatPageSource).toContain('useSessionChatResources')
    expect(appShellDestructure).not.toContain('enabledSources')
    expect(appShellDestructure).not.toContain('skills')
    expect(appShellDestructure).not.toContain('mentionFiles')
    expect(appShellDestructure).not.toContain('openingProjectMetadata')
    expect(appShellDestructure).not.toContain('enabledModes')
    expect(appShellDestructure).not.toContain('onSessionSourcesChange')
  })

  it('uses the narrow session panel chrome context', () => {
    const chatPageSource = readFileSync(new URL('../ChatPage.tsx', import.meta.url), 'utf-8')
    const appShellDestructure = appShellDestructureFrom(chatPageSource)

    expect(chatPageSource).toContain('useSessionPanelChrome')
    expect(chatPageSource.match(/className="border-b-0"/g)).toHaveLength(3)
    expect(chatPageSource).not.toContain('useAppShellContext')
    expect(appShellDestructure).not.toContain('rightSidebarButton')
    expect(appShellDestructure).not.toContain('leadingAction')
    expect(appShellDestructure).not.toContain('isCompactMode')
    expect(appShellDestructure).not.toContain('chatDisplayRef')
    expect(appShellDestructure).not.toContain('onChatMatchInfoChange')
    expect(appShellDestructure).not.toContain('isFocusedPanel')
  })
})
