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
      'novel.oh-story',
      'novel.crucible',
      'novel.creative-writing',
    ])
  })

  it('names choices as Method Pack selections, not generic workspace types', () => {
    const generalOption = WORKSPACE_CREATION_METHOD_OPTIONS.find(option => option.id === 'general')
    const novelOption = WORKSPACE_CREATION_METHOD_OPTIONS.find(option => option.id === 'novel.claude-book')
    const ohStoryOption = WORKSPACE_CREATION_METHOD_OPTIONS.find(option => option.id === 'novel.oh-story')
    const crucibleOption = WORKSPACE_CREATION_METHOD_OPTIONS.find(option => option.id === 'novel.crucible')
    const creativeOption = WORKSPACE_CREATION_METHOD_OPTIONS.find(option => option.id === 'novel.creative-writing')

    expect(generalOption?.fallbackTitle).toBe('No Method Pack')
    expect(novelOption?.fallbackTitle).toBe('Claude-Book Method Pack')
    expect(novelOption?.fallbackSubtitle).toContain('canon')
    expect(ohStoryOption?.fallbackTitle).toBe('Oh Story Web Fiction Pack')
    expect(crucibleOption?.fallbackTitle).toBe('Crucible Structure Pack')
    expect(creativeOption?.fallbackTitle).toBe('Creative Writing Skills Pack')
  })

  it('provides a preview diagram and description for each creation method', () => {
    for (const option of WORKSPACE_CREATION_METHOD_OPTIONS) {
      expect(option.previewMermaidKey).toBe(`workspace.methodOptions.${option.previewKey}.previewMermaid`)
      expect(option.previewDescriptionKey).toBe(`workspace.methodOptions.${option.previewKey}.previewDescription`)
      expect(option.fallbackPreviewMermaid).toContain('flowchart TD')
      expect(option.fallbackPreviewDescription.length).toBeGreaterThan(20)
      expect(option.richPreview.thesis.length).toBeGreaterThan(30)
      expect(option.richPreview.stages.length).toBeGreaterThanOrEqual(3)
      expect(option.richPreview.assets.length).toBeGreaterThanOrEqual(4)
      expect(option.richPreview.bestFor.length).toBeGreaterThan(30)
      expect(option.richPreviewZh.thesis.length).toBeGreaterThan(20)
      expect(option.richPreviewZh.stages.length).toBe(option.richPreview.stages.length)
    }
  })

  it('uses distinct rich preview strategies for the built-in novel method packs', () => {
    const previews = WORKSPACE_CREATION_METHOD_OPTIONS.map(option => option.richPreview)

    expect(previews.map(preview => preview.accent)).toEqual([
      'neutral',
      'canon',
      'market',
      'structure',
      'craft',
    ])
    expect(previews.some(preview => preview.assets.some(asset => asset === 'timeline/'))).toBe(true)
    expect(previews.some(preview => preview.assets.some(asset => asset === '对标/'))).toBe(true)
    expect(previews.some(preview => preview.assets.some(asset => asset === 'planning/'))).toBe(true)
    expect(previews.some(preview => preview.assets.some(asset => asset === 'kb/'))).toBe(true)
  })

  it('maps the Claude-Book novel choice to an explicit Method Pack request', () => {
    expect(buildWorkspaceCreationOptions('novel.claude-book')).toEqual({
      projectType: 'novel',
      methodPackId: 'novel.claude-book',
    })
  })

  it('maps the Oh Story choice to an explicit Method Pack request', () => {
    expect(buildWorkspaceCreationOptions('novel.oh-story')).toEqual({
      projectType: 'novel',
      methodPackId: 'novel.oh-story',
    })
  })

  it('maps the Crucible choice to an explicit Method Pack request', () => {
    expect(buildWorkspaceCreationOptions('novel.crucible')).toEqual({
      projectType: 'novel',
      methodPackId: 'novel.crucible',
    })
  })

  it('maps the Creative Writing Skills choice to an explicit Method Pack request', () => {
    expect(buildWorkspaceCreationOptions('novel.creative-writing')).toEqual({
      projectType: 'novel',
      methodPackId: 'novel.creative-writing',
    })
  })

  it('maps the general choice to a plain workspace request', () => {
    expect(buildWorkspaceCreationOptions('general')).toEqual({
      projectType: 'general',
    })
  })
})
