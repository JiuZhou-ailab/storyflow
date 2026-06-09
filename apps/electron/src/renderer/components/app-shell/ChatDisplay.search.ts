// input: Grouped chat turns, a search query, and the local turn key resolver.
// output: Logical search occurrences for ChatDisplay highlighting and navigation.
// pos: Pure app-shell search helper kept separate from React rendering.

import type { Turn } from '@craft-agent/ui'

export interface TurnSearchOccurrence {
  matchId: string
  turnId: string
  turnIndex: number
  matchIndexInTurn: number
}

export function countSearchOccurrences(text: string, query: string): number {
  if (query.length === 0) return 0

  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  let count = 0
  let pos = 0

  while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
    count++
    pos += lowerQuery.length
  }

  return count
}

function getTurnSearchText(turn: Turn): string {
  if (turn.type === 'user') {
    const content = turn.message.content as unknown
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .filter((block: { type?: string }) => block.type === 'text')
        .map((block: { text?: string }) => block.text || '')
        .join('\n')
    }
    return ''
  }

  if (turn.type === 'assistant') {
    return turn.response?.text ?? ''
  }

  if (turn.type === 'system') {
    return turn.message.content
  }

  return ''
}

export function collectTurnSearchOccurrences(
  turns: readonly Turn[],
  searchQuery: string,
  getTurnKey: (turn: Turn) => string
): TurnSearchOccurrence[] {
  if (!searchQuery.trim()) return []

  const query = searchQuery.toLowerCase()
  const matches: TurnSearchOccurrence[] = []

  for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
    const turn = turns[turnIndex]
    if (!turn) continue

    const turnId = getTurnKey(turn)
    const occurrenceCount = countSearchOccurrences(getTurnSearchText(turn), query)

    for (let matchIndexInTurn = 0; matchIndexInTurn < occurrenceCount; matchIndexInTurn++) {
      matches.push({
        matchId: `${turnId}-match-${matchIndexInTurn}`,
        turnId,
        turnIndex,
        matchIndexInTurn,
      })
    }
  }

  return matches
}
