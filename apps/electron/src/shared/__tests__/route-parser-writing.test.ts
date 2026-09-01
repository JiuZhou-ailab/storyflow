// input: Writing route strings and navigation state
// output: Round-trip regression coverage for the project-first route
// pos: Prevents the writing surface from falling back to session navigation

import { describe, expect, it } from 'bun:test'
import {
  buildRouteFromNavigationState,
  parseCompoundRoute,
  parseRouteToNavigationState,
} from '../route-parser'

describe('writing route', () => {
  it('parses as a navigation state independent from sessions', () => {
    expect(parseCompoundRoute('writing')).toEqual({
      navigator: 'writing',
      details: null,
    })
    expect(parseRouteToNavigationState('writing')).toEqual({ navigator: 'writing' })
  })

  it('round-trips without introducing an allSessions route', () => {
    expect(buildRouteFromNavigationState({ navigator: 'writing' })).toBe('writing')
  })
})

describe('MCP discovery route', () => {
  it('round-trips inside the MCP Sources filter', () => {
    const state = {
      navigator: 'sources' as const,
      filter: { kind: 'type' as const, sourceType: 'mcp' as const },
      details: { type: 'mcp-market' as const },
    }
    expect(parseCompoundRoute('sources/mcp/discover')).toEqual({
      navigator: 'sources',
      sourceFilter: { kind: 'type', sourceType: 'mcp' },
      details: { type: 'mcp-market', id: 'discover' },
    })
    expect(parseRouteToNavigationState('sources/mcp/discover')).toEqual(state)
    expect(buildRouteFromNavigationState(state)).toBe('sources/mcp/discover')
  })
})
