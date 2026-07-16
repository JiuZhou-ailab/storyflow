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
