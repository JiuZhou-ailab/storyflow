// input: Renderer writing workspace file fixtures and search results
// output: Workspace tree, labels, search query, and detection assertions
// pos: Protects the renderer projection of writing workspaces

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { FileChange } from '@craft-agent/ui'
import type { Message } from '@craft-agent/core'
import {
  buildNovelWorkspaceTree,
  detectNovelProjectFromSearchResults,
  describeNovelWorkspaceFile,
  filterReviewableNovelFileChanges,
  getLatestNovelFileChangesFromMessages,
  getNovelFileChangeActivityKey,
  getNovelWorkspaceCandidateRoots,
  getNovelWorkspaceRelativePath,
  getNovelWorkspaceVisibleRootDirectories,
  mapSearchResultsToNovelWorkspaceFiles,
  mapNativeWorkspaceCatalog,
  groupNovelFileChanges,
  groupReviewableNovelFileChanges,
  getShortFormGlobalInfoFiles,
  getNovelImportTargetRelativePath,
  normalizeNovelCreateFilePath,
  isNovelWorkspaceFilePathInRoot,
  isVisibleNovelWorkspaceAssetPath,
  isShortFormNovelWorkspaceFiles,
  areNovelWorkspaceFilesEqual,
  NOVEL_WORKSPACE_DETECTION_QUERIES,
  selectDefaultNovelFile,
  selectDefaultNovelTab,
  summarizeNovelSection,
} from '../writing-workspace'

function testUserMessage(id: string, timestamp: number): Message {
  return { id, role: 'user', content: id, timestamp }
}

function testAssistantMessage(id: string, timestamp: number): Message {
  return { id, role: 'assistant', content: id, timestamp }
}

function testToolMessage(
  id: string,
  timestamp: number,
  toolName: string,
  toolInput: Record<string, unknown> = {},
): Message {
  return {
    id,
    role: 'tool',
    content: '',
    timestamp,
    toolName,
    toolInput,
    toolStatus: 'completed',
    toolResult: '',
  }
}

const fallbackChange: FileChange = {
  id: 'snapshot',
  filePath: '/novel/snapshot.md',
  toolType: 'Write',
  changeKind: 'modify',
  original: 'old',
  modified: 'new',
}

const writingWorkspaceSource = readFileSync(new URL('../writing-workspace.ts', import.meta.url), 'utf8')

describe('writing workspace helpers', () => {
  it('keeps the file-change activity key stable for assistant text deltas', () => {
    expect(getNovelFileChangeActivityKey({
      messages: [
        { role: 'tool', id: 'edit-1', toolName: 'Edit', toolStatus: 'completed' },
        { role: 'assistant', id: 'assistant-1' },
      ],
    })).toBe('edit-1:Edit:completed:')
  })

  it('returns all file changes from the latest assistant turn with file changes', () => {
    const changes = getLatestNovelFileChangesFromMessages({
      messages: [
        testUserMessage('user-1', 1),
        testToolMessage('edit-1', 2, 'Edit', {
          file_path: 'story/chapter-01.md',
          old_string: 'old chapter',
          new_string: 'new chapter',
        }),
        testToolMessage('write-1', 3, 'Write', {
          file_path: 'work/notes.md',
          content: 'notes',
        }),
        testAssistantMessage('assistant-1', 4),
        testUserMessage('user-2', 5),
        testToolMessage('read-1', 6, 'Read', { file_path: 'story/chapter-02.md' }),
        testAssistantMessage('assistant-2', 7),
      ],
      basePath: '/novel',
      fallbackChanges: [fallbackChange],
    })

    expect(changes.map(change => `${change.toolType}:${change.filePath}`)).toEqual([
      'Edit:/novel/story/chapter-01.md',
      'Write:/novel/work/notes.md',
    ])
  })

  it('returns fallback file changes when session messages have no file changes', () => {
    expect(getLatestNovelFileChangesFromMessages({
      messages: [
        testUserMessage('user-1', 1),
        testToolMessage('read-1', 2, 'Read', { file_path: 'story/chapter-01.md' }),
        testAssistantMessage('assistant-1', 3),
      ],
      fallbackChanges: [fallbackChange],
    })).toEqual([fallbackChange])
  })

  it('preserves file-change detection for timestamp-unordered fallback grouping', () => {
    const changes = getLatestNovelFileChangesFromMessages({
      messages: [
        testAssistantMessage('assistant-1', 3),
        testToolMessage('edit-1', 2, 'Edit', {
          file_path: 'story/chapter-01.md',
          old_string: 'old',
          new_string: 'new',
        }),
        testUserMessage('user-1', 1),
      ],
      basePath: '/novel',
    })

    expect(changes.map(change => change.filePath)).toEqual(['/novel/story/chapter-01.md'])
  })

  it('groups novel files into workspace sections', () => {
    const tree = buildNovelWorkspaceTree([
      { path: '/novel/story/chapters/chapter-01.md', relativePath: 'story/chapters/chapter-01.md' },
      { path: '/novel/story/plan.md', relativePath: 'story/plan.md' },
      { path: '/novel/bible/characters/alice.md', relativePath: 'bible/characters/alice.md' },
      { path: '/novel/bible/universe/paris.md', relativePath: 'bible/universe/paris.md' },
      { path: '/novel/state/current/situation.md', relativePath: 'state/current/situation.md' },
      { path: '/novel/timeline/history.md', relativePath: 'timeline/history.md' },
      { path: '/novel/.work/chapter-01-plan.md', relativePath: '.work/chapter-01-plan.md' },
    ])

    expect(tree.manuscript.files.map(file => file.relativePath)).toEqual(['story/chapters/chapter-01.md'])
    expect(tree.outline.files.map(file => file.relativePath)).toEqual(['story/plan.md'])
    expect(tree.characters.files.map(file => file.relativePath)).toEqual(['bible/characters/alice.md'])
    expect(tree.locations.files.map(file => file.relativePath)).toEqual(['bible/universe/paris.md'])
    expect(tree.state.files.map(file => file.relativePath)).toEqual(['state/current/situation.md'])
    expect(tree.timeline.files.map(file => file.relativePath)).toEqual(['timeline/history.md'])
    expect(tree.work.files.map(file => file.relativePath)).toEqual(['.work/chapter-01-plan.md'])
  })

  it('uses Method Pack artifact contracts for workspace section projection', () => {
    const tree = buildNovelWorkspaceTree([
      { path: '/script/剧本/分场大纲.md', relativePath: '剧本/分场大纲.md' },
      { path: '/script/剧本/对白草稿/01-开场.md', relativePath: '剧本/对白草稿/01-开场.md' },
      { path: '/script/角色/人物表.md', relativePath: '角色/人物表.md' },
      { path: '/script/场景/场景表.md', relativePath: '场景/场景表.md' },
      { path: '/script/逻辑/因果链.md', relativePath: '逻辑/因果链.md' },
    ], 'screenplay.logic')

    expect(tree.outline.files.map(file => file.relativePath)).toEqual(['剧本/分场大纲.md'])
    expect(tree.work.files.map(file => file.relativePath)).toEqual(['剧本/对白草稿/01-开场.md'])
    expect(tree.characters.files.map(file => file.relativePath)).toEqual(['角色/人物表.md'])
    expect(tree.locations.files.map(file => file.relativePath)).toEqual(['场景/场景表.md'])
    expect(tree.state.files.map(file => file.relativePath)).toEqual(['逻辑/因果链.md'])
  })

  it('selects manuscript as default when chapters exist', () => {
    const tree = buildNovelWorkspaceTree([
      { path: '/novel/story/chapters/chapter-01.md', relativePath: 'story/chapters/chapter-01.md' },
      { path: '/novel/story/plan.md', relativePath: 'story/plan.md' },
    ])

    expect(selectDefaultNovelTab(tree)).toBe('manuscript')
  })

  it('selects the first manuscript file as the default editable document', () => {
    expect(selectDefaultNovelFile([
      { path: '/novel/story/plan.md', relativePath: 'story/plan.md' },
      { path: '/novel/story/chapters/chapter-02.md', relativePath: 'story/chapters/chapter-02.md' },
      { path: '/novel/story/chapters/chapter-01.md', relativePath: 'story/chapters/chapter-01.md' },
    ])).toEqual({
      path: '/novel/story/chapters/chapter-01.md',
      relativePath: 'story/chapters/chapter-01.md',
    })
  })

  it('selects default files without building and sorting the whole workspace tree', () => {
    const functionStart = writingWorkspaceSource.indexOf('export function selectDefaultNovelFile')
    const functionEnd = writingWorkspaceSource.indexOf('export function summarizeNovelSection', functionStart)
    const functionSource = writingWorkspaceSource.slice(functionStart, functionEnd)

    expect(functionSource).toContain('const bestBySection = new Map<NovelWorkspaceFileSectionId, NovelWorkspaceFile>()')
    expect(functionSource).not.toContain('buildNovelWorkspaceTree(files, methodPackId)')
  })

  it('sorts manuscript chapters by numeric chapter order', () => {
    const tree = buildNovelWorkspaceTree([
      { path: '/novel/story/chapters/chapter-10.md', relativePath: 'story/chapters/chapter-10.md' },
      { path: '/novel/story/chapters/chapter-2.md', relativePath: 'story/chapters/chapter-2.md' },
      { path: '/novel/story/chapters/chapter-1.md', relativePath: 'story/chapters/chapter-1.md' },
    ])

    expect(tree.manuscript.files.map(file => file.relativePath)).toEqual([
      'story/chapters/chapter-1.md',
      'story/chapters/chapter-2.md',
      'story/chapters/chapter-10.md',
    ])
  })

  it('describes fixed novel files with writer-facing labels instead of paths', () => {
    expect(describeNovelWorkspaceFile('bible/structure.md')).toEqual({
      labelKey: 'writing.fileLabels.narrativeStructure',
      fallbackTitle: 'Narrative structure',
    })
    expect(describeNovelWorkspaceFile('story/plan.md')).toEqual({
      labelKey: 'writing.fileLabels.chapterPlan',
      fallbackTitle: 'Chapter plan',
    })
    expect(describeNovelWorkspaceFile('story/chapters/chapter-01.md')).toEqual({
      labelKey: 'writing.fileLabels.chapter',
      labelParams: { number: '1' },
      fallbackTitle: 'Chapter 1',
    })
  })

  it('describes short-form web-fiction workspace files with Chinese writer-facing labels', () => {
    expect(describeNovelWorkspaceFile('全局/创作要求.md')).toEqual({
      fallbackTitle: '创作要求',
    })
    expect(describeNovelWorkspaceFile('全局/简报.md')).toEqual({
      fallbackTitle: '简报',
    })
    expect(describeNovelWorkspaceFile('全局/大纲.md')).toEqual({
      fallbackTitle: '大纲',
    })
    expect(describeNovelWorkspaceFile('全局/人物.md')).toEqual({
      fallbackTitle: '人物',
    })
  })

  it('falls back to a humanized file name for custom novel files', () => {
    expect(describeNovelWorkspaceFile('bible/characters/lin-qing.md')).toEqual({
      fallbackTitle: 'Lin Qing',
    })
    expect(describeNovelWorkspaceFile('story/chapters/prologue.md')).toEqual({
      fallbackTitle: 'Prologue',
    })
  })

  it('falls back to outline when no manuscript file exists', () => {
    expect(selectDefaultNovelFile([
      { path: '/novel/bible/characters/alice.md', relativePath: 'bible/characters/alice.md' },
      { path: '/novel/story/plan.md', relativePath: 'story/plan.md' },
    ])).toEqual({
      path: '/novel/story/plan.md',
      relativePath: 'story/plan.md',
    })
  })

  it('selects outline as default before chapters exist', () => {
    const tree = buildNovelWorkspaceTree([
      { path: '/novel/story/plan.md', relativePath: 'story/plan.md' },
    ])

    expect(selectDefaultNovelTab(tree)).toBe('outline')
  })

  it('summarizes section count and latest modified time', () => {
    const summary = summarizeNovelSection([
      { path: '/novel/story/plan.md', relativePath: 'story/plan.md', modifiedAt: 10 },
      { path: '/novel/story/synopsis.md', relativePath: 'story/synopsis.md', modifiedAt: 20 },
    ])

    expect(summary).toEqual({ count: 2, latestModifiedAt: 20 })
  })

  it('detects unchanged writing workspace file lists', () => {
    const files = [
      { path: '/novel/正文/01.md', relativePath: '正文/01.md', modifiedAt: 10 },
      { path: '/novel/全局/大纲.md', relativePath: '全局/大纲.md' },
    ]

    expect(areNovelWorkspaceFilesEqual(files, [
      { path: '/novel/正文/01.md', relativePath: '正文/01.md', modifiedAt: 10 },
      { path: '/novel/全局/大纲.md', relativePath: '全局/大纲.md' },
    ])).toBe(true)
    expect(areNovelWorkspaceFilesEqual(files, [
      { path: '/novel/正文/01.md', relativePath: '正文/01.md', modifiedAt: 11 },
      { path: '/novel/全局/大纲.md', relativePath: '全局/大纲.md' },
    ])).toBe(false)
    expect(areNovelWorkspaceFilesEqual(files, [...files].reverse())).toBe(false)
  })

  it('groups raw file changes by novel section', () => {
    const changes: FileChange[] = [
      change('/novel/bible/characters/alice.md'),
      change('/novel/story/chapters/chapter-02.md'),
      change('/novel/timeline/current-chapter.md'),
      change('/novel/README.md'),
    ]

    const grouped = groupNovelFileChanges(changes, '/novel')

    expect(grouped.characters.map(item => item.filePath)).toEqual(['/novel/bible/characters/alice.md'])
    expect(grouped.manuscript.map(item => item.filePath)).toEqual(['/novel/story/chapters/chapter-02.md'])
    expect(grouped.timeline.map(item => item.filePath)).toEqual(['/novel/timeline/current-chapter.md'])
    expect(grouped.other.map(item => item.filePath)).toEqual(['/novel/README.md'])
  })

  it('filters changes that are not visible in the writing workspace catalog', () => {
    const changes: FileChange[] = [
      change('/novel/story/chapters/chapter-02.md'),
      change('/novel/自由区/灵感.md'),
      change('/novel/README.md'),
      change('/novel/.codex/session.json'),
    ]

    const reviewableChanges = filterReviewableNovelFileChanges(changes, '/novel')

    expect(reviewableChanges.map(item => item.filePath)).toEqual([
      '/novel/story/chapters/chapter-02.md',
      '/novel/自由区/灵感.md',
    ])
  })

  it('groups reviewable file changes without keeping other files', () => {
    const grouped = groupReviewableNovelFileChanges([
      change('/novel/story/chapters/chapter-02.md'),
      change('/novel/自由区/灵感.md'),
      change('/novel/README.md'),
    ], '/novel')

    expect(grouped.manuscript.map(item => item.filePath)).toEqual(['/novel/story/chapters/chapter-02.md'])
    expect(grouped.work.map(item => item.filePath)).toEqual(['/novel/自由区/灵感.md'])
    expect(grouped.other).toEqual([])
  })

  it('strips the novel workspace root before deriving display paths', () => {
    expect(getNovelWorkspaceRelativePath('/novel/bible/structure.md', '/novel')).toBe('bible/structure.md')
    expect(getNovelWorkspaceRelativePath('/other/bible/structure.md', '/novel')).toBe('/other/bible/structure.md')
  })

  it('recognizes selected files that still belong to the current writing workspace root', () => {
    expect(isNovelWorkspaceFilePathInRoot('/novel/正文/01.md', '/novel')).toBe(true)
    expect(isNovelWorkspaceFilePathInRoot('/novel', '/novel')).toBe(true)
    expect(isNovelWorkspaceFilePathInRoot('/novel-other/正文/01.md', '/novel')).toBe(false)
    expect(isNovelWorkspaceFilePathInRoot('/other/正文/01.md', '/novel')).toBe(false)
  })

  it('maps file search results to novel workspace files and drops unknown files', () => {
    const files = mapSearchResultsToNovelWorkspaceFiles([
      { name: 'chapter-01.md', path: '/novel/story/chapters/chapter-01.md', relativePath: 'story/chapters/chapter-01.md', type: 'file' },
      { name: 'chapter-01.md', path: '/novel/story/chapters/chapter-01.md', relativePath: 'story/chapters/chapter-01.md', type: 'file' },
      { name: 'README.md', path: '/novel/README.md', relativePath: 'README.md', type: 'file' },
      { name: 'situation.md', path: '/novel/state/template/situation.md', relativePath: 'state/template/situation.md', type: 'file' },
      { name: 'characters', path: '/novel/bible/characters', relativePath: 'bible/characters', type: 'directory' },
    ])

    expect(files).toEqual([
      { path: '/novel/story/chapters/chapter-01.md', relativePath: 'story/chapters/chapter-01.md' },
      { path: '/novel/state/template/situation.md', relativePath: 'state/template/situation.md' },
    ])
  })

  it('maps the native project catalog without Method Pack visibility filtering', () => {
    const catalog = mapNativeWorkspaceCatalog([
      { name: '人物.md', path: '/novel/人物.md', relativePath: '人物.md', type: 'file' },
      { name: 'README.md', path: '/novel/README.md', relativePath: 'README.md', type: 'file' },
      { name: '资料', path: '/novel/资料', relativePath: '资料', type: 'directory' },
      { name: '空目录', path: '/novel/资料/空目录', relativePath: '资料/空目录', type: 'directory' },
      { name: '人物.md', path: '/novel/人物.md', relativePath: '人物.md', type: 'file' },
    ])

    expect(catalog).toEqual({
      files: [
        { path: '/novel/README.md', relativePath: 'README.md' },
        { path: '/novel/人物.md', relativePath: '人物.md' },
      ],
      directories: ['资料', '资料/空目录'],
    })
  })

  it('maps short-form web fiction workspace files into the writing workspace projection', () => {
    const files = mapSearchResultsToNovelWorkspaceFiles([
      { name: '创作要求.md', path: '/short/全局/创作要求.md', relativePath: '全局/创作要求.md', type: 'file' },
      { name: '简报.md', path: '/short/全局/简报.md', relativePath: '全局/简报.md', type: 'file' },
      { name: '大纲.md', path: '/short/全局/大纲.md', relativePath: '全局/大纲.md', type: 'file' },
      { name: '人物.md', path: '/short/全局/人物.md', relativePath: '全局/人物.md', type: 'file' },
      { name: '素材.md', path: '/short/素材.md', relativePath: '素材.md', type: 'file' },
      { name: '01-未婚夫和闺蜜在我葬礼上接吻.md', path: '/short/正文/01-未婚夫和闺蜜在我葬礼上接吻.md', relativePath: '正文/01-未婚夫和闺蜜在我葬礼上接吻.md', type: 'file' },
      { name: '03-番外.txt', path: '/short/正文/03-番外.txt', relativePath: '正文/03-番外.txt', type: 'file' },
      { name: '02-雨夜.md', path: '/short/正文/第一卷/02-雨夜.md', relativePath: '正文/第一卷/02-雨夜.md', type: 'file' },
      { name: '反派试稿.md', path: '/short/自由区/脑洞/反派试稿.md', relativePath: '自由区/脑洞/反派试稿.md', type: 'file' },
      { name: '临时笔记.txt', path: '/short/自由区/临时笔记.txt', relativePath: '自由区/临时笔记.txt', type: 'file' },
    ])

    expect(files.map(file => file.relativePath)).toEqual([
      '全局/创作要求.md',
      '全局/简报.md',
      '全局/大纲.md',
      '全局/人物.md',
      '正文/01-未婚夫和闺蜜在我葬礼上接吻.md',
      '正文/03-番外.txt',
      '正文/第一卷/02-雨夜.md',
      '自由区/脑洞/反派试稿.md',
      '自由区/临时笔记.txt',
    ])

    const tree = buildNovelWorkspaceTree(files)
    expect(tree.style.files.map(file => file.relativePath)).toEqual(['全局/创作要求.md'])
    expect(tree.outline.files.map(file => file.relativePath)).toEqual(['全局/大纲.md', '全局/简报.md'])
    expect(tree.characters.files.map(file => file.relativePath)).toEqual(['全局/人物.md'])
    expect(tree.analysis.files.map(file => file.relativePath)).toEqual([])
    expect(tree.manuscript.files.map(file => file.relativePath)).toEqual([
      '正文/01-未婚夫和闺蜜在我葬礼上接吻.md',
      '正文/03-番外.txt',
      '正文/第一卷/02-雨夜.md',
    ])
    expect(tree.work.files.map(file => file.relativePath)).toEqual(['自由区/临时笔记.txt', '自由区/脑洞/反派试稿.md'])
  })

  it('flattens short-form global information files in method pack order', () => {
    const files = mapSearchResultsToNovelWorkspaceFiles([
      { name: '素材.md', path: '/short/素材.md', relativePath: '素材.md', type: 'file' },
      { name: '人物.md', path: '/short/全局/人物.md', relativePath: '全局/人物.md', type: 'file' },
      { name: '正文', path: '/short/正文', relativePath: '正文', type: 'directory' },
      { name: '大纲.md', path: '/short/全局/大纲.md', relativePath: '全局/大纲.md', type: 'file' },
      { name: '简报.md', path: '/short/全局/简报.md', relativePath: '全局/简报.md', type: 'file' },
      { name: '创作要求.md', path: '/short/全局/创作要求.md', relativePath: '全局/创作要求.md', type: 'file' },
      { name: '01-开篇.md', path: '/short/正文/01-开篇.md', relativePath: '正文/01-开篇.md', type: 'file' },
    ])
    const tree = buildNovelWorkspaceTree(files)

    expect(isShortFormNovelWorkspaceFiles(files)).toBe(true)
    expect(getNovelWorkspaceVisibleRootDirectories(files)).toEqual(['正文', '全局', '自由区'])
    expect(getShortFormGlobalInfoFiles(tree).map(file => file.relativePath)).toEqual([
      '全局/创作要求.md',
      '全局/简报.md',
      '全局/大纲.md',
      '全局/人物.md',
    ])
  })

  it('normalizes new manuscript, global information, and free-area file paths to supported text files', () => {
    expect(normalizeNovelCreateFilePath('07-标题', '正文')).toBe('正文/07-标题.md')
    expect(normalizeNovelCreateFilePath('第一卷/07-标题.md', '正文')).toBe('正文/第一卷/07-标题.md')
    expect(normalizeNovelCreateFilePath('角色/主角', '全局')).toBe('全局/角色/主角.md')
    expect(normalizeNovelCreateFilePath('灵感.txt', '自由区')).toBe('自由区/灵感.txt')
    expect(normalizeNovelCreateFilePath(' 临时\\灵感.TXT ', '自由区')).toBe('自由区/临时/灵感.TXT')
    expect(normalizeNovelCreateFilePath('资料.docx', '自由区')).toBeNull()
    expect(normalizeNovelCreateFilePath('../资料', '自由区')).toBeNull()
  })

  it('derives import targets for supported local text files only', () => {
    expect(getNovelImportTargetRelativePath('/Users/me/Desktop/第七章.md', '正文')).toBe('正文/第七章.md')
    expect(getNovelImportTargetRelativePath('/Users/me/Desktop/角色补充.md', '全局')).toBe('全局/角色补充.md')
    expect(getNovelImportTargetRelativePath('C:\\Users\\me\\Desktop\\笔记.TXT', '自由区')).toBe('自由区/笔记.TXT')
    expect(getNovelImportTargetRelativePath('/Users/me/Desktop/资料.docx', '自由区')).toBeNull()
    expect(getNovelImportTargetRelativePath('/Users/me/Desktop/.md', '正文')).toBeNull()
  })

  it('keeps hot-path writing workspace detection manifest-only', () => {
    expect(NOVEL_WORKSPACE_DETECTION_QUERIES).toEqual([
      'craft-writing.json',
      '.craft-agent/craft-writing.json',
    ])
  })

  it('detects a novel project from a manifest search result', () => {
    expect(detectNovelProjectFromSearchResults([
      { name: 'craft-writing.json', path: '/novel/craft-writing.json', relativePath: 'craft-writing.json', type: 'file' },
    ])).toBe(true)
    expect(detectNovelProjectFromSearchResults([
      { name: 'craft-writing.json', path: '/novel/.craft-agent/craft-writing.json', relativePath: '.craft-agent/craft-writing.json', type: 'file' },
    ])).toBe(true)
  })

  it('does not infer writing projects from directory structure on the hot path', () => {
    expect(detectNovelProjectFromSearchResults([
      { name: 'bible', path: '/novel/bible', relativePath: 'bible', type: 'directory' },
      { name: 'story', path: '/novel/story', relativePath: 'story', type: 'directory' },
      { name: 'state', path: '/novel/state', relativePath: 'state', type: 'directory' },
      { name: 'timeline', path: '/novel/timeline', relativePath: 'timeline', type: 'directory' },
    ])).toBe(false)
    expect(detectNovelProjectFromSearchResults([
      { name: '正文', path: '/short/正文', relativePath: '正文', type: 'directory' },
      { name: '创作要求.md', path: '/short/全局/创作要求.md', relativePath: '全局/创作要求.md', type: 'file' },
      { name: '大纲.md', path: '/short/全局/大纲.md', relativePath: '全局/大纲.md', type: 'file' },
      { name: '人物.md', path: '/short/全局/人物.md', relativePath: '全局/人物.md', type: 'file' },
    ])).toBe(false)
  })

  it('detects a free-creation writing workspace from the global facts folder', () => {
    const freeCreationFiles = mapSearchResultsToNovelWorkspaceFiles([
      { name: '全局', path: '/free/全局', relativePath: '全局', type: 'directory' },
      { name: '项目说明.md', path: '/free/全局/项目说明.md', relativePath: '全局/项目说明.md', type: 'file' },
      { name: '创作要求.md', path: '/free/全局/创作要求.md', relativePath: '全局/创作要求.md', type: 'file' },
    ])

    expect(detectNovelProjectFromSearchResults([
      { name: '全局', path: '/free/全局', relativePath: '全局', type: 'directory' },
      { name: '项目说明.md', path: '/free/全局/项目说明.md', relativePath: '全局/项目说明.md', type: 'file' },
      { name: '创作要求.md', path: '/free/全局/创作要求.md', relativePath: '全局/创作要求.md', type: 'file' },
    ])).toBe(false)
    expect(isShortFormNovelWorkspaceFiles(freeCreationFiles)).toBe(false)
    expect(getNovelWorkspaceVisibleRootDirectories(freeCreationFiles)).toEqual([])
  })

  it('does not treat legacy 素材.md as a short-form workspace anchor', () => {
    expect(detectNovelProjectFromSearchResults([
      { name: '正文', path: '/short/正文', relativePath: '正文', type: 'directory' },
      { name: '素材.md', path: '/short/素材.md', relativePath: '素材.md', type: 'file' },
    ])).toBe(false)
  })

  it('keeps system workspace files out of the visible writing asset tree', () => {
    expect(isVisibleNovelWorkspaceAssetPath('全局/项目说明.md')).toBe(true)
    expect(isVisibleNovelWorkspaceAssetPath('正文/01-开场.md')).toBe(true)
    expect(isVisibleNovelWorkspaceAssetPath('labels/config.json')).toBe(false)
    expect(isVisibleNovelWorkspaceAssetPath('sessions/260703-wise-orchid/session.jsonl')).toBe(false)
    expect(isVisibleNovelWorkspaceAssetPath('statuses/config.json')).toBe(false)
    expect(isVisibleNovelWorkspaceAssetPath('AGENTS.md')).toBe(false)
    expect(isVisibleNovelWorkspaceAssetPath('craft-writing.json')).toBe(false)
  })

  it('does not detect partial writing-like structures as a novel project', () => {
    expect(detectNovelProjectFromSearchResults([
      { name: 'story', path: '/repo/story', relativePath: 'story', type: 'directory' },
      { name: 'README.md', path: '/repo/README.md', relativePath: 'README.md', type: 'file' },
    ])).toBe(false)
  })

  it('checks the active workspace root before the session working directory', () => {
    expect(getNovelWorkspaceCandidateRoots({
      activeWorkspaceRootPath: '/workspaces/book',
      sessionWorkingDirectory: '/workspaces/book/sessions/260509-session',
    })).toEqual([
      '/workspaces/book',
      '/workspaces/book/sessions/260509-session',
    ])
  })

  it('ignores stale session working directories outside the active workspace root', () => {
    expect(getNovelWorkspaceCandidateRoots({
      activeWorkspaceRootPath: '/workspaces/new-book',
      sessionWorkingDirectory: '/workspaces/default-book',
    })).toEqual(['/workspaces/new-book'])
  })

  it('deduplicates equivalent novel workspace candidate roots', () => {
    expect(getNovelWorkspaceCandidateRoots({
      activeWorkspaceRootPath: '/workspaces/book/',
      sessionWorkingDirectory: '/workspaces/book',
    })).toEqual(['/workspaces/book'])
  })
})

function change(filePath: string, overrides: Partial<FileChange> = {}): FileChange {
  return {
    id: filePath,
    filePath,
    toolType: 'Edit',
    original: 'old',
    modified: 'new',
    ...overrides,
  }
}
