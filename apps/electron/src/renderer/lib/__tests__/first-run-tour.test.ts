// input: First-run tutorial step definitions
// output: Stable ordered targets for the post-project guide
// pos: Guards that the product tutorial explains the main app controls

import { describe, expect, it } from 'bun:test'
import { FIRST_RUN_TOUR_STEPS } from '../first-run-tour'

describe('FIRST_RUN_TOUR_STEPS', () => {
  it('covers the core first-run workflow from project structure to execution', () => {
    expect(FIRST_RUN_TOUR_STEPS.map(step => step.target)).toEqual([
      'workspace-switcher',
      'writing-catalog',
      'writing-global-info',
      'writing-manuscript',
      'writing-free-area',
      'sources-nav',
      'skills-nav',
      'automations-nav',
      'settings-nav',
      'chat-history',
      'new-session-button',
      'permission-mode-dropdown',
      'chat-input',
      'source-selector-button',
      'send-button',
    ])
  })

  it('keeps each tutorial target unique so progress is meaningful', () => {
    const targets = FIRST_RUN_TOUR_STEPS.map(step => step.target)
    expect(new Set(targets).size).toBe(targets.length)
  })
})
