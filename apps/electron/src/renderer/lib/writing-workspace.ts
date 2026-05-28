// input: File search results, file changes, and workspace/session root paths
// output: Browser-safe novel workspace projection helpers
// pos: Renderer adapter between workspace files and writing workspace UI

import type { FileChange } from '@craft-agent/ui'
import {
  categorizeNovelPath,
  type WritingFileCategory,
} from '@craft-agent/shared/writing/file-categories'
import type { FileSearchResult } from '@craft-agent/shared/protocol'

export type NovelWorkspaceTab =
  | 'manuscript'
  | 'outline'
  | 'characters'
  | 'locations'
  | 'style'
  | 'state'
  | 'timeline'
  | 'analysis'
  | 'work'
  | 'changes'

export interface NovelWorkspaceFile {
  path: string
  relativePath: string
  modifiedAt?: number
}

export type NovelWorkspaceFileSectionId =
  | 'manuscript'
  | 'outline'
  | 'characters'
  | 'locations'
  | 'style'
  | 'state'
  | 'timeline'
  | 'analysis'
  | 'work'
  | 'other'

export interface NovelWorkspaceSection {
  id: NovelWorkspaceFileSectionId
  files: NovelWorkspaceFile[]
}

export type NovelWorkspaceTree = Record<NovelWorkspaceFileSectionId, NovelWorkspaceSection>

export interface NovelSectionSummary {
  count: number
  latestModifiedAt?: number
}

export type NovelFileChangeGroups = Record<WritingFileCategory, FileChange[]>

export interface NovelWorkspaceFileDisplayDescriptor {
  labelKey?: `writing.fileLabels.${string}`
  labelParams?: Record<string, string>
  fallbackTitle: string
}

export interface NovelWorkspaceRootCandidates {
  activeWorkspaceRootPath?: string
  sessionWorkingDirectory?: string
}

export type NovelCreateFileBasePath = '正文' | '自由区'

const NOVEL_CREATE_FILE_ALLOWED_EXTENSIONS = new Set(['.md', '.txt'])
const SHORT_FORM_WORKSPACE_SIGNAL_PATHS = new Set([
  '创作要求.md',
  '简报.md',
  '大纲.md',
  '人物.md',
])
const SHORT_FORM_GLOBAL_INFO_FILE_ORDER = [
  '创作要求.md',
  '简报.md',
  '大纲.md',
  '人物.md',
] as const
const SHORT_FORM_GLOBAL_INFO_FILE_INDEX = new Map<string, number>(
  SHORT_FORM_GLOBAL_INFO_FILE_ORDER.map((path, index) => [path, index])
)

export const NOVEL_WORKSPACE_DETECTION_QUERIES = [
  'craft-writing.json',
  'story/chapters',
  'story/plan.md',
  'story/synopsis.md',
  'bible/structure.md',
  'bible/characters',
  'bible/universe',
  'state',
  'timeline',
  '正文',
  '创作要求.md',
  '简报.md',
  '大纲.md',
  '人物.md',
] as const

export const NOVEL_WORKSPACE_CATALOG_DIRECTORY_QUERIES = [
  'story/chapters',
  'bible/characters',
  'bible/universe',
  'state',
  'timeline',
  '设定',
  '大纲',
  '正文',
  '追踪',
  '参考资料',
  '拆文库',
  '对标',
  '自由区',
] as const

export const NOVEL_WORKSPACE_FILE_SEARCH_QUERIES = [
  'craft-writing.json',
  'story/chapters',
  'story/plan.md',
  'story/synopsis.md',
  'bible/structure.md',
  'bible/characters',
  'bible/universe',
  'state',
  'timeline',
  '设定',
  '大纲',
  '正文',
  '追踪',
  '参考资料',
  '拆文库',
  '对标',
  '自由区',
  '创作要求.md',
  '简报.md',
  '大纲.md',
  '人物.md',
] as const

function createEmptyTree(): NovelWorkspaceTree {
  return {
    manuscript: { id: 'manuscript', files: [] },
    outline: { id: 'outline', files: [] },
    characters: { id: 'characters', files: [] },
    locations: { id: 'locations', files: [] },
    style: { id: 'style', files: [] },
    state: { id: 'state', files: [] },
    timeline: { id: 'timeline', files: [] },
    analysis: { id: 'analysis', files: [] },
    work: { id: 'work', files: [] },
    other: { id: 'other', files: [] },
  }
}

function createEmptyChangeGroups(): NovelFileChangeGroups {
  return {
    manuscript: [],
    outline: [],
    characters: [],
    locations: [],
    style: [],
    state: [],
    timeline: [],
    analysis: [],
    work: [],
    other: [],
  }
}

const relativePathCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

function sortByRelativePath(a: NovelWorkspaceFile, b: NovelWorkspaceFile): number {
  return relativePathCollator.compare(a.relativePath, b.relativePath)
}

function stripRootPath(path: string, rootPath: string): string {
  const normalizedPath = path.replace(/\\/g, '/')
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalizedRoot) return normalizedPath
  if (normalizedPath === normalizedRoot) return ''
  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }
  return normalizedPath
}

export function getNovelWorkspaceRelativePath(path: string, rootPath: string): string {
  return stripRootPath(path, rootPath)
}

function normalizeRootPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

function isSameOrChildPath(path: string, rootPath: string): boolean {
  return path === rootPath || path.startsWith(`${rootPath}/`)
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '')
}

function basename(path: string): string {
  const normalized = normalizeRelativePath(path)
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

function stripMarkdownExtension(filename: string): string {
  return filename.replace(/\.md$/i, '')
}

function getFileExtension(path: string): string | null {
  const fileName = path.split('/').pop() ?? ''
  const match = fileName.match(/(\.[^/.]+)$/)
  return match?.[1]?.toLowerCase() ?? null
}

export function normalizeNovelCreateFilePath(input: string, basePath: NovelCreateFileBasePath): string | null {
  let relative = input.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!relative) return null

  const segments = relative.split('/').map(segment => segment.trim())
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    return null
  }

  relative = segments.join('/')
  const extension = getFileExtension(relative)
  if (!extension) {
    relative = `${relative}.md`
  } else if (!NOVEL_CREATE_FILE_ALLOWED_EXTENSIONS.has(extension)) {
    return null
  }

  return `${basePath}/${relative}`
}

export function getNovelImportTargetRelativePath(sourcePath: string, basePath: NovelCreateFileBasePath): string | null {
  const normalizedPath = sourcePath.trim().replace(/\\/g, '/')
  const fileName = normalizedPath.split('/').pop()?.trim() ?? ''
  if (!fileName || fileName === '.' || fileName === '..') return null

  const extension = getFileExtension(fileName)
  const stem = extension ? fileName.slice(0, -extension.length) : fileName
  if (!extension || !stem || !NOVEL_CREATE_FILE_ALLOWED_EXTENSIONS.has(extension)) {
    return null
  }

  return `${basePath}/${fileName}`
}

function normalizeChapterNumber(rawNumber: string): string {
  const parsed = Number(rawNumber)
  return Number.isFinite(parsed) ? String(parsed) : rawNumber.replace(/^0+/, '') || rawNumber
}

function humanizeFileStem(stem: string): string {
  return stem
    .replace(/^_+|_+$/g, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b[a-z]/g, char => char.toUpperCase())
}

function descriptor(
  fallbackTitle: string,
  labelKey?: NovelWorkspaceFileDisplayDescriptor['labelKey'],
  labelParams?: Record<string, string>
): NovelWorkspaceFileDisplayDescriptor {
  return {
    ...(labelKey ? { labelKey } : {}),
    ...(labelParams ? { labelParams } : {}),
    fallbackTitle,
  }
}

const FIXED_NOVEL_FILE_DESCRIPTORS: Record<string, NovelWorkspaceFileDisplayDescriptor> = {
  'bible/style.md': descriptor('Style guide', 'writing.fileLabels.styleGuide'),
  'bible/structure.md': descriptor('Narrative structure', 'writing.fileLabels.narrativeStructure'),
  'bible/characters/_template.md': descriptor('Character template', 'writing.fileLabels.characterTemplate'),
  'bible/universe/_template.md': descriptor('Location template', 'writing.fileLabels.locationTemplate'),
  'story/synopsis.md': descriptor('Synopsis', 'writing.fileLabels.synopsis'),
  'story/plan.md': descriptor('Chapter plan', 'writing.fileLabels.chapterPlan'),
  'timeline/current-chapter.md': descriptor('Current chapter timeline', 'writing.fileLabels.currentChapterTimeline'),
  'timeline/history.md': descriptor('Story history', 'writing.fileLabels.storyHistory'),
  'state/template/characters.md': descriptor('Character state', 'writing.fileLabels.characterState'),
  'state/template/knowledge.md': descriptor('Knowledge state', 'writing.fileLabels.knowledgeState'),
  'state/template/situation.md': descriptor('Situation state', 'writing.fileLabels.situationState'),
  '创作要求.md': descriptor('创作要求'),
  '简报.md': descriptor('简报'),
  '大纲.md': descriptor('大纲'),
  '人物.md': descriptor('人物'),
}

export function describeNovelWorkspaceFile(fileOrPath: NovelWorkspaceFile | string): NovelWorkspaceFileDisplayDescriptor {
  const relativePath = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.relativePath
  const normalizedPath = normalizeRelativePath(relativePath)
  const fixedDescriptor = FIXED_NOVEL_FILE_DESCRIPTORS[normalizedPath]

  if (fixedDescriptor) return fixedDescriptor

  const fileStem = stripMarkdownExtension(basename(normalizedPath))
  const chapterMatch = normalizedPath.match(/^story\/chapters\/chapter[-_ ]*(\d+)\.md$/i)

  if (chapterMatch?.[1]) {
    const number = normalizeChapterNumber(chapterMatch[1])
    return descriptor('Chapter ' + number, 'writing.fileLabels.chapter', { number })
  }

  const fallbackTitle = humanizeFileStem(fileStem)
  return descriptor(fallbackTitle || normalizedPath)
}

export function getNovelWorkspaceCandidateRoots({
  activeWorkspaceRootPath,
  sessionWorkingDirectory,
}: NovelWorkspaceRootCandidates): string[] {
  const activeRoot = typeof activeWorkspaceRootPath === 'string' && activeWorkspaceRootPath.trim().length > 0
    ? normalizeRootPath(activeWorkspaceRootPath)
    : null
  const sessionRoot = typeof sessionWorkingDirectory === 'string' && sessionWorkingDirectory.trim().length > 0
    ? normalizeRootPath(sessionWorkingDirectory)
    : null
  const roots = [
    activeRoot,
    sessionRoot && (!activeRoot || isSameOrChildPath(sessionRoot, activeRoot)) ? sessionRoot : null,
  ].filter((path): path is string => !!path)

  return [...new Set(roots)]
}

export function buildNovelWorkspaceTree(files: NovelWorkspaceFile[]): NovelWorkspaceTree {
  const tree = createEmptyTree()

  for (const file of files) {
    const category = categorizeNovelPath(file.relativePath)
    tree[category].files.push(file)
  }

  for (const section of Object.values(tree)) {
    section.files.sort(sortByRelativePath)
  }

  return tree
}

export function isShortFormNovelWorkspaceFiles(files: NovelWorkspaceFile[]): boolean {
  return files.some((file) => {
    const relativePath = normalizeRelativePath(file.relativePath)
    return SHORT_FORM_WORKSPACE_SIGNAL_PATHS.has(relativePath) || relativePath.startsWith('自由区/')
  })
}

export function getShortFormGlobalInfoFiles(tree: NovelWorkspaceTree): NovelWorkspaceFile[] {
  const files = [
    ...tree.style.files,
    ...tree.outline.files,
    ...tree.characters.files,
    ...tree.analysis.files,
  ]

  return files
    .filter((file) => SHORT_FORM_GLOBAL_INFO_FILE_INDEX.has(normalizeRelativePath(file.relativePath)))
    .sort((a, b) => {
      const aIndex = SHORT_FORM_GLOBAL_INFO_FILE_INDEX.get(normalizeRelativePath(a.relativePath)) ?? Number.MAX_SAFE_INTEGER
      const bIndex = SHORT_FORM_GLOBAL_INFO_FILE_INDEX.get(normalizeRelativePath(b.relativePath)) ?? Number.MAX_SAFE_INTEGER
      return aIndex - bIndex || sortByRelativePath(a, b)
    })
}

export function selectDefaultNovelTab(tree: NovelWorkspaceTree): NovelWorkspaceTab {
  if (tree.manuscript.files.length > 0) return 'manuscript'
  if (tree.outline.files.length > 0) return 'outline'
  if (tree.characters.files.length > 0) return 'characters'
  return 'outline'
}

export function selectDefaultNovelFile(files: NovelWorkspaceFile[]): NovelWorkspaceFile | undefined {
  const tree = buildNovelWorkspaceTree(files)
  const orderedSections: NovelWorkspaceFileSectionId[] = [
    'manuscript',
    'outline',
    'characters',
    'locations',
    'timeline',
    'state',
    'style',
    'analysis',
    'work',
  ]

  for (const sectionId of orderedSections) {
    const file = tree[sectionId].files[0]
    if (file) return file
  }

  return undefined
}

export function summarizeNovelSection(files: NovelWorkspaceFile[]): NovelSectionSummary {
  const modifiedTimes = files
    .map((file) => file.modifiedAt)
    .filter((value): value is number => typeof value === 'number')

  return {
    count: files.length,
    latestModifiedAt: modifiedTimes.length > 0 ? Math.max(...modifiedTimes) : undefined,
  }
}

export function groupNovelFileChanges(changes: FileChange[], rootPath = ''): NovelFileChangeGroups {
  const groups = createEmptyChangeGroups()

  for (const change of changes) {
    const relativePath = rootPath
      ? stripRootPath(change.filePath, rootPath)
      : change.filePath
    const category = categorizeNovelPath(relativePath)
    groups[category].push(change)
  }

  return groups
}

export function mapSearchResultsToNovelWorkspaceFiles(results: FileSearchResult[]): NovelWorkspaceFile[] {
  const files: NovelWorkspaceFile[] = []
  const seen = new Set<string>()

  for (const result of results) {
    if (result.type !== 'file') continue
    if (categorizeNovelPath(result.relativePath) === 'other') continue
    if (seen.has(result.path)) continue

    seen.add(result.path)
    files.push({
      path: result.path,
      relativePath: result.relativePath,
    })
  }

  return files
}

export function detectNovelProjectFromSearchResults(results: FileSearchResult[]): boolean {
  if (results.some((result) => result.relativePath === 'craft-writing.json' && result.type === 'file')) {
    return true
  }

  const rootDirectories = new Set(
    results
      .filter((result) => result.type === 'directory')
      .map((result) => result.relativePath.split('/')[0])
  )

  if (['bible', 'story', 'state', 'timeline'].every((dir) => rootDirectories.has(dir))) {
    return true
  }

  const relativeFiles = new Set(
    results
      .filter((result) => result.type === 'file')
      .map((result) => result.relativePath)
  )
  const hasShortFormAnchor = [
    '创作要求.md',
    '简报.md',
    '大纲.md',
    '人物.md',
  ].some((path) => relativeFiles.has(path))

  return rootDirectories.has('正文') && hasShortFormAnchor
}
