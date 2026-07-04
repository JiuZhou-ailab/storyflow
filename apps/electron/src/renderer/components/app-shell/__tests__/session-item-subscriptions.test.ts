// input: SessionItem source and messaging binding subscription contracts
// output: Regression coverage for per-row subscription boundaries
// pos: Keeps session rows from rerendering for unrelated messaging binding updates

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const sessionItemSource = readFileSync(new URL('../SessionItem.tsx', import.meta.url), 'utf-8')
const sessionBadgesSource = readFileSync(new URL('../SessionBadges.tsx', import.meta.url), 'utf-8')
const sessionListSource = readFileSync(new URL('../SessionList.tsx', import.meta.url), 'utf-8')
const sessionInfoPopoverSource = readFileSync(new URL('../SessionInfoPopover.tsx', import.meta.url), 'utf-8')
const globalSearchDialogSource = readFileSync(new URL('../GlobalSearchDialog.tsx', import.meta.url), 'utf-8')
const sessionStatusIconSource = readFileSync(new URL('../SessionStatusIcon.tsx', import.meta.url), 'utf-8')
const batchSessionMenuSource = readFileSync(new URL('../BatchSessionMenu.tsx', import.meta.url), 'utf-8')
const chatDisplaySource = readFileSync(new URL('../ChatDisplay.tsx', import.meta.url), 'utf-8')
const chatInputZoneSource = readFileSync(new URL('../input/ChatInputZone.tsx', import.meta.url), 'utf-8')
const activeOptionBadgesSource = readFileSync(new URL('../ActiveOptionBadges.tsx', import.meta.url), 'utf-8')
const sessionFilesSectionSource = readFileSync(new URL('../../right-sidebar/SessionFilesSection.tsx', import.meta.url), 'utf-8')
const appShellSource = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf-8')
const sessionListContextSource = readFileSync(new URL('../../../context/SessionListContext.tsx', import.meta.url), 'utf-8')
const skillsListPanelSource = readFileSync(new URL('../SkillsListPanel.tsx', import.meta.url), 'utf-8')
const sourcesListPanelSource = readFileSync(new URL('../SourcesListPanel.tsx', import.meta.url), 'utf-8')

describe('session item subscriptions', () => {
  it('reads messaging bindings through a per-session atom', () => {
    expect(sessionItemSource).toContain('messagingBindingsForSessionAtomFamily')
    expect(sessionItemSource).toContain('useAtomValue(messagingBindingsForSessionAtomFamily(item.id))')
    expect(sessionItemSource).not.toContain('useAtomValue(messagingBindingsBySessionAtom)')
    expect(sessionItemSource).not.toContain('messagingBindingsBySession.get(item.id)')
  })

  it('keeps list-level app shell and action subscriptions out of each row', () => {
    expect(sessionListSource).toContain("useActionLabel('chat.nextSearchMatch')")
    expect(sessionListSource).toContain("useActionLabel('chat.prevSearchMatch')")
    expect(sessionListSource).toContain('hasRemoteWorkspaces,')
    expect(sessionListSource).toContain('isCompactMode,')
    expect(sessionItemSource).toContain('ctx.nextSearchMatchHotkey')
    expect(sessionItemSource).toContain('ctx.prevSearchMatchHotkey')
    expect(sessionListSource).not.toContain('useAppShellContext')
    expect(sessionItemSource).not.toContain('useAppShellContext')
    expect(sessionItemSource).not.toContain('useActionLabel')
  })

  it('does not pass unused session selection callbacks into SessionList', () => {
    const sessionListCall = appShellSource.slice(
      appShellSource.indexOf('<SessionList'),
      appShellSource.indexOf('/>', appShellSource.indexOf('<SessionList'))
    )

    expect(sessionListCall).not.toContain('onSessionSelect=')
    expect(sessionListSource).not.toContain('onSessionSelect?:')
  })

  it('does not rebroadcast unused session options through the session list context', () => {
    const sessionListCall = appShellSource.slice(
      appShellSource.indexOf('<SessionList'),
      appShellSource.indexOf('/>', appShellSource.indexOf('<SessionList'))
    )

    expect(sessionListCall).not.toContain('sessionOptions=')
    expect(sessionListSource).not.toContain('sessionOptions?:')
    expect(sessionListContextSource).not.toContain('sessionOptions')
  })

  it('keeps pending prompts out of the broad app shell context', () => {
    expect(appShellSource).not.toContain('pendingPermissions,')
    expect(sessionListSource).not.toContain('hasPendingPrompt?:')
    expect(sessionListContextSource).not.toContain('hasPendingPrompt')
    expect(sessionItemSource).toContain('useAtomValue(hasPendingPromptAtomFamily(item.id))')
  })

  it('keeps the skills list off broad app shell context subscriptions', () => {
    const skillsListCall = appShellSource.slice(
      appShellSource.indexOf('<SkillsListPanel'),
      appShellSource.indexOf('/>', appShellSource.indexOf('<SkillsListPanel'))
    )

    expect(skillsListPanelSource).not.toContain('useAppShellContext')
    expect(skillsListPanelSource).not.toContain('useActiveWorkspace')
    expect(skillsListCall).toContain('activeWorkspace={activeWorkspace}')
    expect(skillsListCall).toContain('workspaces={workspaces}')
  })

  it('keeps the sources list off broad app shell context subscriptions', () => {
    const sourcesListCall = appShellSource.slice(
      appShellSource.indexOf('<SourcesListPanel'),
      appShellSource.indexOf('/>', appShellSource.indexOf('<SourcesListPanel'))
    )

    expect(sourcesListPanelSource).not.toContain('useAppShellContext')
    expect(sourcesListCall).toContain('activeWorkspaceId={activeWorkspaceId}')
    expect(sourcesListCall).toContain('workspaces={workspaces}')
  })

  it('keeps the batch session menu on the session list context', () => {
    expect(batchSessionMenuSource).not.toContain('useAppShellContext')
    expect(batchSessionMenuSource).toContain('useSessionListContext')
  })

  it('keeps the per-row status icon off the shared list context', () => {
    const statusIconCall = sessionItemSource.slice(
      sessionItemSource.indexOf('<SessionStatusIcon'),
      sessionItemSource.indexOf('/>', sessionItemSource.indexOf('<SessionStatusIcon'))
    )

    expect(sessionStatusIconSource).not.toContain('useSessionListContext')
    expect(sessionStatusIconSource).toContain('memo(function SessionStatusIcon')
    expect(statusIconCall).toContain('sessionId={item.id}')
    expect(statusIconCall).toContain('status={getSessionStatus(item)}')
    expect(statusIconCall).toContain('sessionStatuses={ctx.sessionStatuses}')
    expect(statusIconCall).toContain('onSessionStatusChange={ctx.onSessionStatusChange}')
  })

  it('reuses a label lookup map instead of scanning labels per row badge', () => {
    expect(sessionListSource).toContain('const labelById = useMemo')
    expect(sessionListSource).toContain('labelById,')
    expect(sessionItemSource).toContain('resolveSessionLabelBadges(item.labels, ctx.labelById)')
    expect(sessionItemSource).not.toContain('extractLabelId')
    expect(sessionBadgesSource).toContain('export function resolveSessionLabelBadges')
    expect(sessionBadgesSource).toContain('labelById.get(parsed.id)')
    expect(sessionBadgesSource).not.toContain('ctx.labelById')
    expect(sessionItemSource).not.toContain('ctx.flatLabels.some')
    expect(sessionBadgesSource).not.toContain('ctx.flatLabels.find')
  })

  it('keeps session list bucket order without re-sorting rows inside each group', () => {
    expect(sessionListSource).toContain('const unreadRows: SessionListRow[] = []')
    expect(sessionListSource).toContain('const groupsByKey = new Map<string, { rows: SessionListRow[], statusId: string }>()')
    expect(sessionListSource).not.toContain('unreadRows.sort((a, b) =>')
    expect(sessionListSource).not.toContain('readRows.sort((a, b) =>')
    expect(sessionListSource).not.toContain('groupRows.sort((a, b) =>')
  })

  it('reuses status and collapsed-group lookup maps while building session list groups', () => {
    const rowDataSource = sessionListSource.slice(
      sessionListSource.indexOf('const rowData = useMemo(() => {'),
      sessionListSource.indexOf('const flatRows = rowData.rows')
    )

    expect(rowDataSource).toContain('const statusById = new Map(sessionStatuses.map(state => [state.id, state]))')
    expect(rowDataSource).toContain('const collapsedMetaByKey = new Map(collapsedGroupsMeta.map(meta => [meta.key, meta]))')
    expect(rowDataSource).not.toContain('sessionStatuses.find(s => s.id === statusId)')
    expect(rowDataSource).not.toContain('collapsedGroupsMeta.find(m => m.key === key)')
  })

  it('uses the shared date group key helper for date grouping', () => {
    expect(sessionListSource).toContain('getSessionDateGroupKey')
    expect(sessionListSource).not.toContain('startOfDay(new Date(row.item.lastMessageAt || 0)).toISOString()')
    expect(sessionListSource).not.toContain('startOfDay(new Date(item.lastMessageAt || 0)).toISOString()')
  })

  it('keeps selected session state out of the shared list context', () => {
    expect(sessionListSource).not.toContain('selectedSessionId:')
    expect(sessionListSource).not.toContain('focusedSessionId, selectionStore.state.selected, isMultiSelectActive')
  })

  it('reuses the row index map when syncing external selection into keyboard focus', () => {
    expect(sessionListSource).toContain('const selectedSessionId = selectionStore.state.selected')
    expect(sessionListSource).toContain('const selectedRowIndex = rowIndexMap.get(selectedSessionId)')
    expect(sessionListSource).not.toContain('flatRows.findIndex(row => row.item.id === selectionStore.state.selected)')
  })

  it('keeps the entity list row id selector stable across renders', () => {
    expect(sessionListSource).toContain('const getSessionRowId = useCallback((row: SessionListRow) => row.item.id, [])')
    expect(sessionListSource).toContain('getId: getSessionRowId')
    expect(sessionListSource).not.toContain('getId: (row) => row.item.id')
  })

  it('does not rebroadcast chat search row context for match index changes', () => {
    const matchInfoGuardSource = appShellSource.slice(
      appShellSource.indexOf('const handleChatMatchInfoChange = React.useCallback'),
      appShellSource.indexOf('// Reset match info when search is deactivated')
    )

    expect(matchInfoGuardSource).toContain('prev.sessionId === info.sessionId && prev.count === info.count && prev.isHighlighting === info.isHighlighting')
    expect(matchInfoGuardSource).not.toContain('prev.index === info.index')
    expect(sessionItemSource).not.toContain('activeMatch!.index')
  })

  it('does not reset empty chat match info to a new object', () => {
    const matchInfoResetSource = appShellSource.slice(
      appShellSource.indexOf('// Reset match info when search is deactivated'),
      appShellSource.indexOf('// Filter dropdown')
    )

    expect(matchInfoResetSource).toContain('prev.sessionId === null && prev.count === 0 && prev.index === 0')
    expect(matchInfoResetSource).toContain('return prev')
    expect(matchInfoResetSource).not.toContain('setChatMatchInfo({ sessionId: null, count: 0, index: 0 })')
  })

  it('keeps session info popover on metadata instead of full session updates', () => {
    const contentSource = sessionInfoPopoverSource.slice(
      sessionInfoPopoverSource.indexOf('function SessionInfoPopoverContent'),
      sessionInfoPopoverSource.indexOf('React.useEffect(() => {', sessionInfoPopoverSource.indexOf('function SessionInfoPopoverContent'))
    )

    expect(sessionInfoPopoverSource).toContain('sessionMetaAtomFamily')
    expect(contentSource).toContain('useAtomValue(sessionMetaAtomFamily(sessionId))')
    expect(contentSource).not.toContain('useSession(sessionId)')
  })

  it('keeps session info and file popovers off broad app shell context subscriptions', () => {
    expect(sessionInfoPopoverSource).not.toContain('useAppShellContext')
    expect(sessionFilesSectionSource).not.toContain('useAppShellContext')
    expect(sessionInfoPopoverSource).toContain('onRenameSession: (sessionId: string, name: string) => void')
    expect(sessionFilesSectionSource).toContain('onOpenFile: (path: string) => void')
    expect(chatDisplaySource).toContain('onRenameSession?: (sessionId: string, name: string) => void')
    expect(chatInputZoneSource).toContain('onRenameSession?: (sessionId: string, name: string) => void')
    expect(activeOptionBadgesSource).toContain('onRenameSession?: (sessionId: string, name: string) => void')
    expect(chatDisplaySource).toContain('onOpenFile={onOpenFile}')
    expect(chatInputZoneSource).toContain('onOpenFile={onOpenFile}')
    expect(activeOptionBadgesSource).toContain('onOpenFile={onOpenFile}')
  })

  it('keeps whole-session metadata subscriptions out of the app shell', () => {
    expect(appShellSource).not.toContain('useAtomValue(sessionMetaMapAtom)')
    expect(appShellSource).toContain('useAtomValue(sessionMetaAtomFamily(rawEffectiveSessionId')
    expect(sessionListSource).toContain('useAtomValue(sessionMetaMapAtom)')
    expect(globalSearchDialogSource).toContain('useAtomValue(sessionMetaMapAtom)')
  })
})
