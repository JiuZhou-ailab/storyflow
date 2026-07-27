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
  it('adds novel writing workspace guidance while preserving the base Storyflow prompt', () => {
    const preset: SystemPromptPreset = 'novel'

    const prompt = getSystemPrompt(
      undefined,
      undefined,
      '/tmp/workspace',
      '/tmp/workspace',
      preset,
      'Storyflow Backend',
      false
    )

    expect(prompt).toContain('You are Storyflow - an AI assistant')
    expect(prompt).toContain('Novel Writing Workspace')
    expect(prompt).toContain('preserve manuscript prose')
    expect(prompt).toContain('bible as canon')
    expect(prompt).toContain('story files as manuscript or planning material')
    expect(prompt).toContain('state and timeline files as continuity records')
    expect(prompt).toContain('read the relevant bible, outline, current state, and timeline')
    expect(prompt).toContain('Group changes by manuscript, outline, characters, locations, state, timeline, and working notes')
    expect(prompt).toContain('Prefer relevant Skills')
    expect(prompt).toContain('Do not draft directly from a broad first writing request')
    expect(prompt).toContain('use a relevant Skill when available')
  })

  it('keeps the mini preset focused on quick configuration edits', () => {
    expect(getSystemPrompt(
      undefined,
      undefined,
      '/tmp/workspace',
      '/tmp/workspace',
      'mini',
      'Storyflow Backend',
      false
    )).toBe(getMiniAgentSystemPrompt('/tmp/workspace'))
  })

  it('does not inject removed writing-profile runtime metadata', () => {
    const rootPath = '/tmp/storyflow-project'
    const prompt = getSystemPrompt(
      undefined,
      undefined,
      rootPath,
      rootPath,
      'novel',
      'Storyflow Backend',
      false
    )

    expect(prompt).not.toContain('Method Pack')
    expect(prompt).not.toContain('method_pack')
    expect(prompt).toContain('Novel Writing Workspace')
  })
})
