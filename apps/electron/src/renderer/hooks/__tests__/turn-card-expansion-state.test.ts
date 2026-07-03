// input: persisted turn-card expansion records
// output: regression coverage for default expanded thinking/activity state
// pos: guards the chat turn activity expansion persistence contract

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

import {
  createTurnExpansionState,
  createTurnExpansionEntry,
  isTurnExpandedByDefault,
  readCollapsedTurns,
} from '../useTurnCardExpansion'

const hookSource = readFileSync(new URL('../useTurnCardExpansion.ts', import.meta.url), 'utf-8')

describe('turn card expansion state', () => {
  it('expands thinking/activity turns by default when no collapsed state exists', () => {
    expect(isTurnExpandedByDefault('turn-1', new Set())).toBe(true)
  })

  it('persists explicit collapsed turns instead of old expanded-only state', () => {
    const collapsed = readCollapsedTurns({
      collapsedTurns: ['turn-2'],
      turns: ['legacy-expanded-turn'],
      groups: [],
      lastAccessed: 1,
    })

    expect(isTurnExpandedByDefault('turn-1', collapsed)).toBe(true)
    expect(isTurnExpandedByDefault('turn-2', collapsed)).toBe(false)
    expect(createTurnExpansionEntry(['turn-2'], [], 10)).toEqual({
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

    expect(state.collapsedTurns.has('turn-2')).toBe(true)
    expect([...state.expandedActivityGroups]).toEqual(['group-1'])
  })

  it('keeps hook initialization on one expansion state read', () => {
    expect(hookSource).toContain('const [expansionState, setExpansionState] = useState')
    expect(hookSource).not.toContain('const [collapsedTurns, setCollapsedTurns]')
    expect(hookSource).not.toContain('const [expandedActivityGroups, setExpandedActivityGroups] = useState')
  })
})
