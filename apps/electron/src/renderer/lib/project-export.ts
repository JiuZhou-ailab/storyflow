// input: Project files and explicit file or folder selections
// output: Stable, path-preserving export plans
// pos: Pure planning layer between the project surface and filesystem writes

import type { NovelWorkspaceFile } from './writing-workspace'

export interface ProjectExportOptions {
  selectedPaths: string[]
}

export interface ProjectCopyExportEntry {
  kind: 'copy'
  sourcePath: string
  targetRelativePath: string
}

export interface ProjectExportPlan {
  entries: ProjectCopyExportEntry[]
  sourceFileCount: number
}

function normalizeRelativePath(path: string): string | null {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!normalized) return null
  const segments = normalized.split('/')
  return segments.some(segment => !segment || segment === '.' || segment === '..')
    ? null
    : segments.join('/')
}

function isSelected(relativePath: string, selectedPath: string): boolean {
  return relativePath === selectedPath || relativePath.startsWith(`${selectedPath}/`)
}

export function buildProjectExportPlan(
  files: NovelWorkspaceFile[],
  options: ProjectExportOptions,
): ProjectExportPlan {
  const selectedPaths = [...new Set(options.selectedPaths
    .map(normalizeRelativePath)
    .filter((path): path is string => path !== null))]
  const entries = files
    .filter(file => selectedPaths.some(selectedPath => isSelected(file.relativePath, selectedPath)))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, undefined, {
      numeric: true,
      sensitivity: 'base',
    }))
    .map(file => ({
      kind: 'copy',
      sourcePath: file.path,
      targetRelativePath: file.relativePath,
    }) satisfies ProjectCopyExportEntry)

  return { entries, sourceFileCount: entries.length }
}

export function getProjectExportDirectories(files: NovelWorkspaceFile[]): string[] {
  const directories = new Set<string>()
  for (const file of files) {
    const segments = file.relativePath.replace(/\\/g, '/').split('/')
    segments.pop()
    for (let index = 1; index <= segments.length; index += 1) {
      directories.add(segments.slice(0, index).join('/'))
    }
  }

  return [...directories].sort((left, right) => left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: 'base',
  }))
}

export function createProjectExportFolderName(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hour = pad(date.getHours())
  const minute = pad(date.getMinutes())
  const second = pad(date.getSeconds())

  return `exports/project-export-${year}${month}${day}-${hour}${minute}${second}`
}
