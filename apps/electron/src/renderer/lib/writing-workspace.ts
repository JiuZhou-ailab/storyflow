import type { FileChange } from '@craft-agent/ui'
import {
  categorizeNovelPath,
  type WritingFileCategory,
} from '@craft-agent/shared/writing'

export type NovelWorkspaceTab =
  | 'manuscript'
  | 'outline'
  | 'characters'
  | 'locations'
  | 'state'
  | 'timeline'
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

function sortByRelativePath(a: NovelWorkspaceFile, b: NovelWorkspaceFile): number {
  return a.relativePath.localeCompare(b.relativePath)
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

export function selectDefaultNovelTab(tree: NovelWorkspaceTree): NovelWorkspaceTab {
  if (tree.manuscript.files.length > 0) return 'manuscript'
  if (tree.outline.files.length > 0) return 'outline'
  if (tree.characters.files.length > 0) return 'characters'
  return 'outline'
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
