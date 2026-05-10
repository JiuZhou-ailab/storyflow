// input: Workspace creation method selection helpers
// output: Behavioral checks for project type and Method Pack option mapping
// pos: Protects the UI-to-scaffold contract for new workspace creation

import { describe, expect, it } from 'bun:test'
import {
  buildWorkspaceCreationOptions,
  WORKSPACE_CREATION_METHOD_OPTIONS,
} from '../workspace-method-options'

describe('workspace creation method options', () => {
  it('keeps the UI choices intentionally small', () => {
    expect(WORKSPACE_CREATION_METHOD_OPTIONS.map(option => option.id)).toEqual([
      'general',
      'novel.claude-book',
    ])
  })

  it('names choices as Method Pack selections, not generic workspace types', () => {
    const generalOption = WORKSPACE_CREATION_METHOD_OPTIONS.find(option => option.id === 'general')
    const novelOption = WORKSPACE_CREATION_METHOD_OPTIONS.find(option => option.id === 'novel.claude-book')

    expect(generalOption?.fallbackTitle).toBe('No Method Pack')
    expect(novelOption?.fallbackTitle).toBe('Claude-Book Method Pack')
    expect(novelOption?.fallbackSubtitle).toContain('canon')
  })

  it('maps the Claude-Book novel choice to an explicit Method Pack request', () => {
    expect(buildWorkspaceCreationOptions('novel.claude-book')).toEqual({
      projectType: 'novel',
      methodPackId: 'novel.claude-book',
    })
  })

  it('maps the general choice to a plain workspace request', () => {
    expect(buildWorkspaceCreationOptions('general')).toEqual({
      projectType: 'general',
    })
  })
})
