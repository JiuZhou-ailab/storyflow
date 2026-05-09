// input: system prompt preset generation helpers
// output: regression tests for novel writing system prompt behavior
// pos: validates prompt profiles for writing workspaces

import { describe, expect, it, mock } from 'bun:test'

mock.module('../../config/preferences.ts', () => ({
  getCoAuthorPreference: () => false,
  formatPreferencesForPrompt: () => '',
}))

import { getMiniAgentSystemPrompt, getSystemPrompt, type SystemPromptPreset } from '../system'

describe('novel system prompt preset', () => {
  it('adds novel writing workspace guidance while preserving the base Craft Agent prompt', () => {
    const preset: SystemPromptPreset = 'novel'

    const prompt = getSystemPrompt(
      undefined,
      undefined,
      '/tmp/workspace',
      '/tmp/workspace',
      preset,
      'Craft Agents Backend',
      false
    )

    expect(prompt).toContain('You are Craft Agent - an AI assistant')
    expect(prompt).toContain('Novel Writing Workspace')
    expect(prompt).toContain('preserve manuscript prose')
    expect(prompt).toContain('bible as canon')
    expect(prompt).toContain('story files as manuscript or planning material')
    expect(prompt).toContain('state and timeline files as continuity records')
    expect(prompt).toContain('read the relevant bible, outline, current state, and timeline')
    expect(prompt).toContain('Group changes by manuscript, outline, characters, locations, state, timeline, and working notes')
    expect(prompt).toContain('prefer project and workspace skills')
  })

  it('keeps the mini preset focused on quick configuration edits', () => {
    expect(getSystemPrompt(
      undefined,
      undefined,
      '/tmp/workspace',
      '/tmp/workspace',
      'mini',
      'Craft Agents Backend',
      false
    )).toBe(getMiniAgentSystemPrompt('/tmp/workspace'))
  })
})
