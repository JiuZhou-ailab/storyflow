// input: TurnCard source code
// output: Regression checks for completed-turn memoization contracts
// pos: Guards TurnCard against global UI state invalidating unrelated completed turns

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const turnCardSource = readFileSync(new URL('../TurnCard.tsx', import.meta.url), 'utf8')
const sessionViewerSource = readFileSync(new URL('../SessionViewer.tsx', import.meta.url), 'utf8')
const chatDisplaySource = readFileSync(new URL('../../../../../../apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx', import.meta.url), 'utf8')

describe('TurnCard performance contracts', () => {
  it('does not re-render completed turns for unrelated activity group expansion changes', () => {
    expect(turnCardSource).toContain('function hasRelevantActivityGroupExpansionChanged')
    expect(turnCardSource).toContain('hasRelevantActivityGroupExpansionChanged(prev.activities, prev.expandedActivityGroups, next.expandedActivityGroups)')
    expect(turnCardSource).not.toContain('prev.expandedActivityGroups !== next.expandedActivityGroups')
  })

  it('derives edit/write activity availability inside TurnCard', () => {
    expect(turnCardSource).toContain('const effectiveHasEditOrWriteActivities = React.useMemo')
    expect(turnCardSource).toContain('hasEditOrWriteActivities={effectiveHasEditOrWriteActivities}')
    expect(chatDisplaySource).not.toContain('hasEditOrWriteActivities={turn.activities.some')
    expect(sessionViewerSource).not.toContain('hasEditOrWriteActivities={turn.activities.some')
  })

  it('computes collapsed preview metadata without repeated activity scans', () => {
    const functionStart = turnCardSource.indexOf('function getPreviewText(')
    const functionEnd = turnCardSource.indexOf('// ============================================================================\n// Sub-Components', functionStart)
    const previewSource = turnCardSource.slice(functionStart, functionEnd)

    expect(previewSource).toContain('const runningToolNames: string[] = []')
    expect(previewSource).not.toContain('activities.find(')
    expect(previewSource).not.toContain('activities.filter(')
    expect(previewSource).not.toContain('[...activities]')
    expect(previewSource).not.toContain('.reverse()')
  })

  it('reuses timestamp-ordered activities instead of always cloning and sorting', () => {
    expect(turnCardSource).toContain('function getTimestampOrderedActivities(')
    expect(turnCardSource).toContain('getTimestampOrderedActivities(activities)')
    expect(turnCardSource).not.toContain('() => [...activities].sort')
  })
})
