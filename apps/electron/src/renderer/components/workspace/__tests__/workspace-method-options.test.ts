// input: Workspace creation method selection helpers
// output: Behavioral checks for project type and Method Pack option mapping
// pos: Protects the UI-to-scaffold contract for new workspace creation

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { build } from 'esbuild'
import { renderMermaidSVG } from 'beautiful-mermaid'
import { generateSlug } from '@craft-agent/shared/workspaces'
import {
  getBuiltInMethodPack,
  type MethodPackId,
} from '@craft-agent/shared/writing/method-packs'
import { slugify } from '../../../lib/slugify'
import {
  DEFAULT_WORKSPACE_CREATION_METHOD_ID,
  buildWorkspaceFolderPath,
  buildWorkspaceCreationOptions,
  WORKSPACE_CREATION_METHOD_OPTIONS,
} from '../workspace-method-options'

describe('workspace creation method options', () => {
  it('offers the built-in writing Method Packs', () => {
    expect(WORKSPACE_CREATION_METHOD_OPTIONS.map(option => option.id)).toEqual([
      'novel.claude-book',
      'novel.oh-story',
      'novel.crucible',
      'novel.creative-writing',
      'short-form.article',
    ])
  })

  it('uses Chinese copy for Method Pack choices and explanations', () => {
    const novelOption = WORKSPACE_CREATION_METHOD_OPTIONS.find(option => option.id === 'novel.claude-book')
    const ohStoryOption = WORKSPACE_CREATION_METHOD_OPTIONS.find(option => option.id === 'novel.oh-story')
    const crucibleOption = WORKSPACE_CREATION_METHOD_OPTIONS.find(option => option.id === 'novel.crucible')
    const creativeOption = WORKSPACE_CREATION_METHOD_OPTIONS.find(option => option.id === 'novel.creative-writing')
    const shortFormOption = WORKSPACE_CREATION_METHOD_OPTIONS.find(option => option.id === 'short-form.article')

    expect(novelOption?.fallbackTitle).toBe('Claude-Book 小说法')
    expect(novelOption?.fallbackTitle).not.toContain('长篇')
    expect(novelOption?.fallbackSubtitle).toMatch(/[\u4e00-\u9fff]/)
    expect(novelOption?.fallbackPreviewDescription).toContain('长篇小说')
    expect(novelOption?.fallbackPreviewMermaid).toContain('项目圣经')
    expect(ohStoryOption?.fallbackTitle).toBe('Oh Story 网文连载法')
    expect(crucibleOption?.fallbackTitle).toBe('Crucible 结构长篇法')
    expect(creativeOption?.fallbackTitle).toBe('Creative Writing 技法工坊')
    expect(shortFormOption?.fallbackTitle).toBe('短篇/中篇小说')
    expect(shortFormOption?.fallbackSubtitle).toContain('网文')
    expect(shortFormOption?.fallbackSubtitle).toContain('5,000-30,000')
    expect(shortFormOption?.fallbackSubtitle).not.toContain('5,000-40,000')
    expect(shortFormOption?.fallbackPreviewDescription).toContain('5,000-30,000')
    expect(shortFormOption?.fallbackPreviewDescription).not.toContain('5,000-40,000')
  })

  it('uses Short-Form as the default creation method', () => {
    expect(DEFAULT_WORKSPACE_CREATION_METHOD_ID).toBe('short-form.article')
  })

  it('provides a preview diagram and description for each creation method', () => {
    for (const option of WORKSPACE_CREATION_METHOD_OPTIONS) {
      expect(option.previewMermaidKey).toBe(`workspace.methodOptions.${option.previewKey}.previewMermaid`)
      expect(option.previewDescriptionKey).toBe(`workspace.methodOptions.${option.previewKey}.previewDescription`)
      expect(option.fallbackPreviewMermaid).toContain('flowchart TD')
      expect(option.fallbackPreviewMermaid.match(/-->/g)?.length ?? 0).toBeGreaterThanOrEqual(10)
      expect(option.fallbackPreviewDescription.length).toBeGreaterThan(20)
      expect(option.fallbackPreviewMermaid).toMatch(/[\u4e00-\u9fff]/)
      expect(option.richPreview.thesis.length).toBeGreaterThan(30)
      expect(option.richPreview.stages.length).toBeGreaterThanOrEqual(3)
      expect(option.richPreview.structure.length).toBeGreaterThanOrEqual(3)
      expect(option.richPreview.structure.every(group => group.items.length >= 2)).toBe(true)
      expect(option.richPreview.assets.length).toBeGreaterThanOrEqual(4)
      expect(option.richPreview.bestFor.length).toBeGreaterThan(15)
      expect(option.richPreviewZh.thesis.length).toBeGreaterThan(20)
      expect(option.richPreviewZh.stages.length).toBe(option.richPreview.stages.length)
      expect(option.richPreviewZh.structure.length).toBe(option.richPreview.structure.length)
    }
  })

  it('renders every Chinese preview diagram with beautiful-mermaid', () => {
    for (const option of WORKSPACE_CREATION_METHOD_OPTIONS) {
      expect(renderMermaidSVG(option.fallbackPreviewMermaid)).toContain('<svg')
    }
  })

  it('exposes each Method Pack file contract to the renderer preview', () => {
    for (const option of WORKSPACE_CREATION_METHOD_OPTIONS.filter(option => option.methodPackId)) {
      const methodPack = getBuiltInMethodPack(option.methodPackId as MethodPackId)

      if (!methodPack) {
        throw new Error(`Missing Method Pack: ${option.methodPackId}`)
      }
      expect(option.fileContract).toEqual(methodPack.requiredPaths)
    }
  })

  it('keeps renderer method options browser-bundleable', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'craft-method-options-'))
    const entryPath = join(tempDir, 'entry.ts')
    const methodOptionsPath = join(process.cwd(), 'apps/electron/src/renderer/components/workspace/workspace-method-options.ts')

    writeFileSync(
      entryPath,
      `import { WORKSPACE_CREATION_METHOD_OPTIONS } from ${JSON.stringify(methodOptionsPath)};\n` +
        `globalThis.__methodOptionCount = WORKSPACE_CREATION_METHOD_OPTIONS.length;\n`
    )

    try {
      const result = await build({
        entryPoints: [entryPath],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        write: false,
      })

      expect(result.outputFiles[0]?.text).not.toContain('node:fs')
      expect(result.outputFiles[0]?.text).not.toContain('__vite-browser-external')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('uses distinct rich preview strategies for the built-in writing method packs', () => {
    const previews = WORKSPACE_CREATION_METHOD_OPTIONS.map(option => option.richPreview)

    expect(previews.map(preview => preview.accent)).toEqual([
      'canon',
      'market',
      'structure',
      'craft',
      'neutral',
    ])
    expect(previews.some(preview => preview.assets.some(asset => asset === 'timeline/'))).toBe(true)
    expect(previews.some(preview => preview.assets.some(asset => asset === '对标/'))).toBe(true)
    expect(previews.some(preview => preview.assets.some(asset => asset === 'planning/'))).toBe(true)
    expect(previews.some(preview => preview.assets.some(asset => asset === 'kb/'))).toBe(true)
    expect(previews.some(preview => preview.assets.some(asset => asset === '简报.md'))).toBe(true)
    expect(previews.some(preview => preview.structure.some(group => group.label === 'Canon 层'))).toBe(true)
    expect(previews.some(preview => preview.structure.some(group => group.label === '市场层'))).toBe(true)
    expect(previews.some(preview => preview.structure.some(group => group.label === '节拍治理'))).toBe(true)
    expect(previews.some(preview => preview.structure.some(group => group.label === '工坊层'))).toBe(true)
    expect(previews.some(preview => preview.structure.some(group => group.label === '长期约定'))).toBe(true)
  })

  it('builds a default workspace folder path for Chinese names on Windows', () => {
    expect(buildWorkspaceFolderPath({
      homeDir: 'C:\\Users\\zjding',
      name: '九州小说',
      customPath: null,
      locationOption: 'default',
    })).toMatch(/^C:\\Users\\zjding\\\.craft-agent\\workspaces\\workspace-[a-z0-9]+$/)
  })

  it('builds a custom workspace folder path for Chinese names on Windows', () => {
    expect(buildWorkspaceFolderPath({
      homeDir: 'C:\\Users\\zjding',
      name: '九州小说',
      customPath: 'D:\\写作项目',
      locationOption: 'custom',
    })).toMatch(/^D:\\写作项目\\workspace-[a-z0-9]+$/)
  })

  it('keeps renderer slug generation aligned with shared workspace storage', () => {
    for (const name of ['九州小说', '九州 Story', 'Story_九州 01', 'Story九州01']) {
      expect(slugify(name)).toBe(generateSlug(name))
    }
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

  it('maps the Short-Form Writing choice to an explicit Method Pack request', () => {
    expect(buildWorkspaceCreationOptions('short-form.article')).toEqual({
      projectType: 'short-form',
      methodPackId: 'short-form.article',
    })
  })

})
