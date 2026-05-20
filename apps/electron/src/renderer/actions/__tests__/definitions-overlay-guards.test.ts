// input: Action registry definitions for renderer keyboard shortcuts
// output: Regression coverage for overlay-safe global shortcuts
// pos: Guards action metadata that prevents modal stacking regressions

import { describe, expect, it } from 'bun:test'
import { actions } from '../definitions'

describe('action overlay guards', () => {
  it('does not open global search while another menu or dialog is open', () => {
    expect(actions['app.search'].when).toBe('!menuOpen')
  })
})
