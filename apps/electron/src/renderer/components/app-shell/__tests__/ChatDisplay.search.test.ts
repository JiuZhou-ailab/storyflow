// input: Searchable chat turns and a local turn key resolver.
// output: Regression coverage for ChatDisplay transcript search occurrence extraction.
// pos: Pure helper tests for app-shell in-chat search performance plumbing.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { Message } from '../../../../shared/types'
import type { Turn } from '@craft-agent/ui'
import { collectTurnSearchOccurrences } from '../ChatDisplay.search'

const chatDisplaySource = readFileSync(new URL('../ChatDisplay.tsx', import.meta.url), 'utf-8')

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

  test('finds the latest user message without cloning and reversing the transcript', () => {
    expect(chatDisplaySource).toContain('const latestUserMessage = React.useMemo')
    expect(chatDisplaySource).not.toContain('[...transcriptMessages].reverse()')
  })
})
