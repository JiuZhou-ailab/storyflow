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
      'short-form.article',
      'novel.claude-book',
      'screenplay.logic',
      'novel.free-creation',
    ])
  })

  it('uses Chinese copy for Method Pack choices and explanations', () => {
    const novelOption = WORKSPACE_CREATION_METHOD_OPTIONS.find(option => option.id === 'novel.claude-book')
    const screenplayOption = WORKSPACE_CREATION_METHOD_OPTIONS.find(option => option.id === 'screenplay.logic')
    const freeCreationOption = WORKSPACE_CREATION_METHOD_OPTIONS.find(option => option.id === 'novel.free-creation')
    const shortFormOption = WORKSPACE_CREATION_METHOD_OPTIONS.find(option => option.id === 'short-form.article')

    expect(novelOption?.fallbackTitle).toBe('长文小说')
    expect(novelOption?.fallbackTitle).not.toContain('Claude')
    expect(novelOption?.fallbackSubtitle).toMatch(/[\u4e00-\u9fff]/)
    expect(novelOption?.fallbackPreviewDescription).toContain('长篇小说')
    expect(novelOption?.fallbackPreviewMermaid).toContain('项目圣经')
    expect(screenplayOption?.fallbackTitle).toBe('剧本逻辑')
    expect(screenplayOption?.fallbackPreviewDescription).toContain('分场')
    expect(freeCreationOption?.fallbackTitle).toBe('自由创作')
    expect(freeCreationOption?.fallbackPreviewDescription).toContain('不强塞结构')
    expect(shortFormOption?.fallbackTitle).toBe('短篇/中篇小说')
    expect(shortFormOption?.fallbackSubtitle).toContain('网文')
    expect(shortFormOption?.fallbackSubtitle).toContain('5,000-30,000')
    expect(shortFormOption?.fallbackSubtitle).not.toContain('5,000-40,000')
    expect(shortFormOption?.fallbackPreviewDescription).toContain('5,000-30,000')
    expect(shortFormOption?.fallbackPreviewDescription).toContain('黄金三章')
    expect(shortFormOption?.fallbackPreviewMermaid).toContain('黄金三章')
    expect(JSON.stringify(shortFormOption)).not.toContain('素材')
    expect(shortFormOption?.richPreview.thesis).toContain('黄金三章')
    expect(shortFormOption?.richPreview.stages.some(stage => stage.label === '黄金三章')).toBe(true)
    expect(shortFormOption?.richPreview.structure.some(group => group.items.some(item => item.includes('简报.md')))).toBe(true)
    expect(shortFormOption?.richPreview.structure.some(group => group.items.some(item => item.includes('黄金三章.md')))).toBe(false)
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
    const previewAssets: string[] = previews.flatMap(preview => preview.assets)

    expect(previews.map(preview => preview.accent)).toEqual([
      'neutral',
      'canon',
      'structure',
      'free',
    ])
    expect(previewAssets).toContain('timeline/')
    expect(previewAssets).toContain('剧本/')
    expect(previewAssets).toContain('全局/项目说明.md')
    expect(previewAssets).toContain('全局/简报.md')
    expect(previewAssets).not.toContain('黄金三章.md')
    expect(previews.some(preview => preview.structure.some(group => group.label === 'Canon 层'))).toBe(true)
    expect(previews.some(preview => preview.structure.some(group => group.label === '剧本层'))).toBe(true)
    expect(previews.some(preview => preview.structure.some(group => group.label === '项目事实'))).toBe(true)
    expect(previews.some(preview => preview.structure.some(group => group.label === '全局'))).toBe(true)
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

  it('maps the screenplay logic choice to an explicit Method Pack request', () => {
    expect(buildWorkspaceCreationOptions('screenplay.logic')).toEqual({
      projectType: 'screenplay',
      methodPackId: 'screenplay.logic',
    })
  })

  it('maps the free creation choice to an explicit Method Pack request', () => {
    expect(buildWorkspaceCreationOptions('novel.free-creation')).toEqual({
      projectType: 'novel',
      methodPackId: 'novel.free-creation',
    })
  })

  it('maps the Short-Form Writing choice to an explicit Method Pack request', () => {
    expect(buildWorkspaceCreationOptions('short-form.article')).toEqual({
      projectType: 'short-form',
      methodPackId: 'short-form.article',
    })
  })

})
