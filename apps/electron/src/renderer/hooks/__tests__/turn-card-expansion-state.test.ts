// input: persisted turn-card expansion records
// output: regression coverage for default expanded thinking/activity state
// pos: guards the chat turn activity expansion persistence contract

import { describe, expect, it } from 'bun:test'

import {
  createTurnExpansionEntry,
  isTurnExpandedByDefault,
  readCollapsedTurns,
} from '../useTurnCardExpansion'

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
})
