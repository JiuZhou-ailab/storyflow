// input: First-run tutorial step definitions
// output: Stable ordered targets for the post-project guide
// pos: Guards that the product tutorial explains the main app controls

import { describe, expect, it } from 'bun:test'
import { FIRST_RUN_TOUR_STEPS } from '../first-run-tour'

describe('FIRST_RUN_TOUR_STEPS', () => {
  it('covers the core first-run workflow from project structure to execution', () => {
    expect(FIRST_RUN_TOUR_STEPS.map(step => step.target)).toEqual([
      'activity-project-hub',
      'writing-catalog',
      'writing-global-info',
      'writing-manuscript',
      'writing-free-area',
      'activity-sources',
      'activity-skills',
      'activity-settings',
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

  it('targets the activity rail entries that now own global navigation', () => {
    for (const target of ['activity-project-hub', 'activity-sources', 'activity-skills', 'activity-settings']) {
      const step = FIRST_RUN_TOUR_STEPS.find(item => item.target === target)
      expect(step?.selector).toBe(`[data-tutorial="${target}"]`)
    }

    expect(FIRST_RUN_TOUR_STEPS.some(step => step.target === 'automations-nav')).toBe(false)
  })
})
