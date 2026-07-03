// input: Searchable chat turns and a local turn key resolver.
// output: Regression coverage for ChatDisplay transcript search occurrence extraction.
// pos: Pure helper tests for app-shell in-chat search performance plumbing.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { Message } from '../../../../shared/types'
import type { Turn } from '@craft-agent/ui'
import { collectTurnSearchOccurrences } from '../ChatDisplay.search'

const chatDisplaySource = readFileSync(new URL('../ChatDisplay.tsx', import.meta.url), 'utf-8')
const inputContainerSource = readFileSync(new URL('../input/InputContainer.tsx', import.meta.url), 'utf-8')
const freeFormInputSource = readFileSync(new URL('../input/FreeFormInput.tsx', import.meta.url), 'utf-8')
const appShellSource = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf-8')
const appShellContextSource = readFileSync(new URL('../../../context/AppShellContext.tsx', import.meta.url), 'utf-8')
const chatPageSource = readFileSync(new URL('../../../pages/ChatPage.tsx', import.meta.url), 'utf-8')

function message(overrides: Partial<Omit<Message, 'content'>> & { content?: unknown }): Message {
  return {
    id: 'msg',
    role: 'user',
    content: '',
    timestamp: 0,
    ...overrides,
  } as Message
}

function turnKey(turn: Turn): string {
  if (turn.type === 'user') return `user-${turn.message.id}`
  if (turn.type === 'system') return `system-${turn.message.id}`
  if (turn.type === 'auth-request') return `auth-${turn.message.id}`
  return `turn-${turn.turnId}-${turn.timestamp}`
}

describe('collectTurnSearchOccurrences', () => {
  test('collects occurrence-level matches from already grouped turns', () => {
    const turns: Turn[] = [
      {
        type: 'user',
        message: message({
          id: 'u1',
          content: [
            { type: 'text', text: 'Alpha' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'Alpha' } },
            { type: 'text', text: 'alpha' },
          ],
          timestamp: 1,
        }),
        timestamp: 1,
      },
      {
        type: 'assistant',
        turnId: 'a1',
        activities: [],
        response: {
          text: 'no match here',
          isStreaming: false,
        },
        isStreaming: false,
        isComplete: true,
        timestamp: 2,
      },
      {
        type: 'system',
        message: message({
          id: 's1',
          role: 'error',
          content: 'ALPHA',
          timestamp: 3,
        }),
        timestamp: 3,
      },
    ]

    expect(collectTurnSearchOccurrences(turns, 'alpha', turnKey)).toEqual([
      { matchId: 'user-u1-match-0', turnId: 'user-u1', turnIndex: 0, matchIndexInTurn: 0 },
      { matchId: 'user-u1-match-1', turnId: 'user-u1', turnIndex: 0, matchIndexInTurn: 1 },
      { matchId: 'system-s1-match-0', turnId: 'system-s1', turnIndex: 2, matchIndexInTurn: 0 },
    ])
  })

  test('returns no matches for blank queries', () => {
    const turns: Turn[] = [
      {
        type: 'assistant',
        turnId: 'a1',
        activities: [],
        response: {
          text: 'alpha',
          isStreaming: false,
        },
        isStreaming: false,
        isComplete: true,
        timestamp: 1,
      },
    ]

    expect(collectTurnSearchOccurrences(turns, '   ', turnKey)).toEqual([])
  })
})

describe('ChatDisplay search performance contract', () => {
  test('reuses grouped turns and memoized membership for search rendering', () => {
    const fullTranscriptGroupingCalls = chatDisplaySource.match(/groupMessagesByTurn\(transcriptMessages\)/g)?.length ?? 0

    expect(fullTranscriptGroupingCalls).toBe(1)
    expect(chatDisplaySource).toContain('if (!isSearchActive) return []')
    expect(chatDisplaySource).toContain('collectTurnSearchOccurrences(allTurns, searchQuery, getTurnKey)')
    expect(chatDisplaySource).toContain('const matchingTurnIdSet = useMemo(() => {')
    expect(chatDisplaySource).toContain('for (const occurrence of matchingOccurrences)')
    expect(chatDisplaySource).toContain('const currentMatchTurnId = validMatches[currentMatchIndex]?.turnId ?? null')
    expect(chatDisplaySource).toContain('matchingTurnIdSet.has(turnKey)')
    expect(chatDisplaySource).toContain('currentMatchTurnId === turnKey')
    expect(chatDisplaySource).not.toContain('const matchingTurnIds = useMemo')
    expect(chatDisplaySource).not.toContain('matchingOccurrences.map(m => m.turnId)')
    expect(chatDisplaySource).not.toContain('matchingTurnIds.includes(')
  })

  test('precomputes suffix user-turn state instead of scanning visible turns during render', () => {
    expect(chatDisplaySource).toContain('const hasUserTurnAfterIndex = React.useMemo')
    expect(chatDisplaySource).toContain('hasUserTurnAfterIndex[index]')
    expect(chatDisplaySource).not.toContain('turns.slice(index + 1).some')
  })

  test('reuses message partitioning to find the latest user message', () => {
    expect(chatDisplaySource).toContain('let latestUserMessage: Message | undefined')
    expect(chatDisplaySource).toContain('latestUserMessage = message')
    expect(chatDisplaySource).toContain('return { queuedUserMessages, transcriptMessages, latestUserMessage, pendingFollowUpAnnotations }')
    expect(chatDisplaySource).toContain('const latestUserMessage = partitionedMessages.latestUserMessage')
    expect(chatDisplaySource).not.toContain('const latestUserMessage = React.useMemo')
    expect(chatDisplaySource).not.toContain('[...transcriptMessages].reverse()')
  })

  test('reuses message partitioning to collect pending follow-up annotations', () => {
    expect(chatDisplaySource).toContain('const pendingFollowUpAnnotations: PendingFollowUpAnnotation[] = []')
    expect(chatDisplaySource).toContain('pendingFollowUpAnnotations.sort((a, b) => a.createdAt - b.createdAt)')
    expect(chatDisplaySource).toContain('const pendingFollowUpAnnotations = partitionedMessages.pendingFollowUpAnnotations')
    expect(chatDisplaySource).not.toContain('const pendingFollowUpAnnotations = useMemo<PendingFollowUpAnnotation[]>')
  })

  test('does not broadcast pending follow-up state to every TurnCard', () => {
    expect(chatDisplaySource).toContain('const hasPlanFollowUpAnnotations =')
    expect(chatDisplaySource).toContain('hasActiveFollowUpAnnotations={hasPlanFollowUpAnnotations}')
    expect(chatDisplaySource).not.toContain('hasActiveFollowUpAnnotations={pendingFollowUpAnnotations.length > 0}')
  })

  test('passes annotation open requests only to the matching TurnCard', () => {
    expect(chatDisplaySource).toContain('const turnOpenAnnotationRequest = openAnnotationRequest')
    expect(chatDisplaySource).toContain('openAnnotationRequest={turnOpenAnnotationRequest}')
    expect(chatDisplaySource).not.toContain('openAnnotationRequest={openAnnotationRequest}')
  })

  test('keeps user message memoization independent from edit callback identity', () => {
    expect(chatDisplaySource).toContain('const handleRewindUserMessageRef = React.useRef(handleRewindUserMessage)')
    expect(chatDisplaySource).toContain('handleRewindUserMessageRef.current = handleRewindUserMessage')
    expect(chatDisplaySource).toContain('void handleRewindUserMessageRef.current(turn.message)')
    expect(chatDisplaySource).toContain('Boolean(prev.onEdit) === Boolean(next.onEdit)')
    expect(chatDisplaySource).not.toContain('prev.onEdit === next.onEdit')
  })

  test('skips assistant turn indexing when no follow-ups are pending', () => {
    const indexStart = chatDisplaySource.indexOf('const assistantTurnIndexByMessageId = useMemo(() => {')
    const indexEnd = chatDisplaySource.indexOf('const scrollToFollowUpTurn = useCallback', indexStart)
    const indexSource = chatDisplaySource.slice(indexStart, indexEnd)

    expect(indexSource).toContain('if (pendingFollowUpAnnotations.length === 0) return new Map<string, number>()')
    expect(indexSource).toContain('}, [allTurns, pendingFollowUpAnnotations.length])')
  })

  test('builds search highlight text while walking text nodes once', () => {
    const effectStart = chatDisplaySource.indexOf('// Effect 1: Walk DOM and collect highlight ranges')
    const effectEnd = chatDisplaySource.indexOf('// Effect 2: Update active/passive highlight split', effectStart)
    const effectSource = chatDisplaySource.slice(effectStart, effectEnd)

    expect(effectSource).toContain('const textChunks: string[] = []')
    expect(effectSource).toContain('textChunks.push(text)')
    expect(effectSource).toContain("const concatenated = textChunks.join('')")
    expect(effectSource).not.toContain("textNodes.map(n => n.textContent || '').join('')")
  })

  test('updates only the active custom highlight during match navigation', () => {
    const effectStart = chatDisplaySource.indexOf('// Effect 2: Update active/passive highlight split')
    const effectEnd = chatDisplaySource.indexOf('// Navigate to next match', effectStart)
    const effectSource = chatDisplaySource.slice(effectStart, effectEnd)

    expect(chatDisplaySource).toContain('passiveHighlight.priority = 0')
    expect(chatDisplaySource).toContain('activeHighlight.priority = 1')
    expect(effectSource).toContain("cssHighlights.set('search-active', activeHighlight)")
    expect(effectSource).not.toContain('allRanges.filter')
    expect(effectSource).not.toContain("cssHighlights.set('search-passive'")
  })

  test('keeps session-list search query out of AppShellContext value', () => {
    expect(appShellSource).toContain('useAtom(sessionListSearchActiveAtom)')
    expect(appShellSource).toContain('useAtom(sessionListSearchQueryAtom)')
    expect(appShellSource).not.toContain('sessionListSearchQuery: searchActive ? searchQuery : undefined')
    expect(appShellSource).not.toContain('isSearchModeActive: searchActive')
    expect(appShellContextSource).not.toContain('sessionListSearchQuery?:')
    expect(appShellContextSource).not.toContain('isSearchModeActive?:')
    expect(appShellContextSource).not.toContain('setSessionListSearchQuery?:')
    expect(chatPageSource).toContain('activeSessionListSearchQueryAtom')
    expect(chatPageSource).toContain('sessionListSearchActiveAtom')
  })

  test('keeps ChatDisplay and input chrome off AppShellContext subscriptions', () => {
    expect(chatDisplaySource).not.toContain('useAppShellContext')
    expect(inputContainerSource).not.toContain('useOptionalAppShellContext')
    expect(chatDisplaySource).toContain('chatOpening = resolveChatOpeningPrompt({})')
    expect(chatDisplaySource).toContain('isFocusedPanel = true')
    expect(inputContainerSource).toContain('isFocusedPanel = true')
    expect(chatPageSource).toContain('resolveChatOpeningPrompt')
    expect(chatPageSource).toContain('chatOpening={chatOpening}')
    expect(chatPageSource).toContain('isFocusedPanel={isFocusedPanel ?? true}')
  })

  test('keeps freeform input off AppShellContext subscriptions', () => {
    expect(freeFormInputSource).not.toContain('useOptionalAppShellContext')
    expect(freeFormInputSource).toContain('llmConnections = []')
    expect(freeFormInputSource).toContain('workspaceDefaultConnection')
    expect(freeFormInputSource).toContain('workspaceRootPath')
    expect(freeFormInputSource).toContain('workspaceSlug')
    expect(inputContainerSource).toContain('...freeFormProps')
    expect(chatDisplaySource).toContain('refreshLlmConnections,')
  })
})
