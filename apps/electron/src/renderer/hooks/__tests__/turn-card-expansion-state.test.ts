// input: persisted turn-card expansion records
// output: regression coverage for lifecycle-derived thinking/activity expansion
// pos: guards the chat turn activity expansion persistence contract

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

import {
  createTurnExpansionState,
  createTurnExpansionEntry,
  resolveTurnExpanded,
  readCollapsedTurns,
  readExpandedTurns,
} from '../useTurnCardExpansion'

const hookSource = readFileSync(new URL('../useTurnCardExpansion.ts', import.meta.url), 'utf-8')

describe('turn card expansion state', () => {
  it('expands active turns and collapses completed turns by default', () => {
    expect(resolveTurnExpanded('turn-1', false, new Set(), new Set())).toBe(true)
    expect(resolveTurnExpanded('turn-1', true, new Set(), new Set())).toBe(false)
  })

  it('persists explicit expansion overrides in either direction', () => {
    const entry = {
      collapsedTurns: ['turn-2'],
      turns: ['turn-3'],
      groups: [],
      lastAccessed: 1,
    }
    const expanded = readExpandedTurns(entry)
    const collapsed = readCollapsedTurns(entry)

    expect(resolveTurnExpanded('turn-2', false, expanded, collapsed)).toBe(false)
    expect(resolveTurnExpanded('turn-3', true, expanded, collapsed)).toBe(true)
    expect(createTurnExpansionEntry(['turn-3'], ['turn-2'], [], 10)).toEqual({
      turns: ['turn-3'],
      collapsedTurns: ['turn-2'],
      groups: [],
      lastAccessed: 10,
    })
  })

  it('derives collapsed turns and activity groups from one entry', () => {
    const state = createTurnExpansionState({
      collapsedTurns: ['turn-2'],
      groups: ['group-1'],
      lastAccessed: 1,
    })

    expect(state.expandedTurns.size).toBe(0)
    expect(state.collapsedTurns.has('turn-2')).toBe(true)
    expect([...state.expandedActivityGroups]).toEqual(['group-1'])
  })

  it('keeps hook initialization on one expansion state read', () => {
    expect(hookSource).toContain('const [expansionState, setExpansionState] = useState')
    expect(hookSource).not.toContain('const [collapsedTurns, setCollapsedTurns]')
    expect(hookSource).not.toContain('const [expandedActivityGroups, setExpandedActivityGroups] = useState')
  })
})
