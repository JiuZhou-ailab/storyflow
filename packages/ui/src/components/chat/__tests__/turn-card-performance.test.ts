// input: TurnCard source code
// output: Regression checks for completed-turn memoization contracts
// pos: Guards TurnCard against global UI state invalidating unrelated completed turns

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const turnCardSource = readFileSync(new URL('../TurnCard.tsx', import.meta.url), 'utf8')

describe('TurnCard performance contracts', () => {
  it('does not re-render completed turns for unrelated activity group expansion changes', () => {
    expect(turnCardSource).toContain('function hasRelevantActivityGroupExpansionChanged')
    expect(turnCardSource).toContain('hasRelevantActivityGroupExpansionChanged(prev.activities, prev.expandedActivityGroups, next.expandedActivityGroups)')
    expect(turnCardSource).not.toContain('prev.expandedActivityGroups !== next.expandedActivityGroups')
  })
})
