// input: Novel workspace files, selected export sections, and manuscript content
// output: Export plans and merged manuscript content for writing workspace exports
// pos: Pure planning layer between writing workspace UI and filesystem writes

import { categorizeNovelPath } from '@craft-agent/shared/writing/file-categories'
import {
  buildNovelWorkspaceTree,
  type NovelWorkspaceFile,
  type NovelWorkspaceFileSectionId,
} from './writing-workspace'

export type NovelExportSection = Exclude<NovelWorkspaceFileSectionId, 'other'>

export const NOVEL_EXPORT_SECTIONS: NovelExportSection[] = [
  'manuscript',
  'outline',
  'characters',
  'locations',
  'style',
  'timeline',
  'state',
  'analysis',
  'work',
]

export interface NovelExportOptions {
  sections: NovelExportSection[]
  mergeManuscript: boolean
}

export interface NovelCopyExportEntry {
  kind: 'copy'
  sourcePath: string
  targetRelativePath: string
}

export interface NovelMergedManuscriptExportEntry {
  kind: 'merged-manuscript'
  sourcePaths: string[]
  targetRelativePath: string
}

export type NovelExportEntry = NovelCopyExportEntry | NovelMergedManuscriptExportEntry

export interface NovelExportPlan {
  entries: NovelExportEntry[]
  sourceFileCount: number
}

export interface ManuscriptContentPart {
  sourcePath: string
  content: string
}

export function buildNovelExportPlan(
  files: NovelWorkspaceFile[],
  options: NovelExportOptions
): NovelExportPlan {
  const selectedSections = new Set(options.sections)
  const tree = buildNovelWorkspaceTree(files)
  const entries: NovelExportEntry[] = []
  let sourceFileCount = 0

  if (selectedSections.has('manuscript') && options.mergeManuscript) {
    const manuscriptFiles = tree.manuscript.files
    if (manuscriptFiles.length > 0) {
      sourceFileCount += manuscriptFiles.length
      entries.push({
        kind: 'merged-manuscript',
        sourcePaths: manuscriptFiles.map(file => file.path),
        targetRelativePath: 'manuscript.md',
      })
    }
  }

  for (const file of files) {
    const section = categorizeNovelPath(file.relativePath)
    if (section === 'other') continue
    if (!selectedSections.has(section)) continue
    if (section === 'manuscript' && options.mergeManuscript) continue

    sourceFileCount += 1
    entries.push({
      kind: 'copy',
      sourcePath: file.path,
      targetRelativePath: file.relativePath,
    })
  }

  return { entries, sourceFileCount }
}

export function buildMergedManuscriptContent(parts: ManuscriptContentPart[]): string {
  const content = parts
    .map(part => part.content.replace(/\n+$/g, ''))
    .filter(Boolean)
    .join('\n\n')

  return content ? `${content}\n` : ''
}

export function createNovelExportFolderName(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hour = pad(date.getHours())
  const minute = pad(date.getMinutes())
  const second = pad(date.getSeconds())

  return `exports/novel-export-${year}${month}${day}-${hour}${minute}${second}`
}
