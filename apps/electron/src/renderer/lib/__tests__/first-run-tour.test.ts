// input: First-run tutorial step definitions
// output: Stable ordered targets for the post-project guide
// pos: Guards that the product tutorial explains the main app controls

import { describe, expect, it } from 'bun:test'
import { FIRST_RUN_TOUR_STEPS } from '../first-run-tour'

describe('FIRST_RUN_TOUR_STEPS', () => {
  it('covers the first successful writing task instead of every app surface', () => {
    expect(FIRST_RUN_TOUR_STEPS.map(step => step.target)).toEqual([
      'writing-catalog',
      'writing-global-info',
      'writing-manuscript',
      'chat-input',
      'source-selector-button',
      'permission-mode-dropdown',
      'send-button',
      'activity-profile',
    ])
  })

  it('keeps each tutorial target unique so progress is meaningful', () => {
    const targets = FIRST_RUN_TOUR_STEPS.map(step => step.target)
    expect(new Set(targets).size).toBe(targets.length)
  })

  it('keeps secondary app surfaces out of the blocking first-run path', () => {
    for (const target of ['activity-project-hub', 'activity-sources', 'activity-skills', 'activity-settings']) {
      expect(FIRST_RUN_TOUR_STEPS.some(step => step.target === target)).toBe(false)
    }
    expect(FIRST_RUN_TOUR_STEPS.some(step => step.target === 'automations-nav')).toBe(false)
  })

  it('points users to the profile menu that owns settings, updates, and feedback', () => {
    const profileStep = FIRST_RUN_TOUR_STEPS.find(step => step.target === 'activity-profile')
    expect(profileStep?.selector).toBe('[data-tutorial="activity-profile"]')
    expect(profileStep?.body).toContain('帮助反馈')
  })
})
