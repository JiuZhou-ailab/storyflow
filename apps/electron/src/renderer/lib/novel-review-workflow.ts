// input: File change records and local accept/reject status
// output: Pending changed-file projections for the writing workspace review bar
// pos: Pure workflow helper for Cursor-style novel diff review navigation

import type { FileChange } from '@craft-agent/ui'
import type { NovelWorkspaceFile } from './writing-workspace'

export type NovelReviewStatusMap = Record<string, 'pending' | 'accepted' | 'rejected'>

function normalizeReviewPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

function isAbsoluteReviewPath(path: string): boolean {
  const normalized = normalizeReviewPath(path)
  return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')
}

function joinRootPath(rootPath: string, relativePath: string): string {
  const root = normalizeReviewPath(rootPath)
  const relative = normalizeReviewPath(relativePath).replace(/^\/+/, '')
  return relative ? `${root}/${relative}` : root
}

function stripRootPath(path: string, rootPath: string): string {
  const normalizedPath = normalizeReviewPath(path)
  const normalizedRoot = normalizeReviewPath(rootPath)
  if (!normalizedRoot) return normalizedPath
  if (normalizedPath === normalizedRoot) return ''
  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }
  return normalizedPath
}

function stripDiffSidePrefix(path: string): string {
  return path.replace(/^(?:a|b)\//, '')
}

export function normalizeNovelFileChangePaths(
  changes: FileChange[],
  rootPath: string | null | undefined,
  files: Pick<NovelWorkspaceFile, 'path' | 'relativePath'>[],
): FileChange[] {
  const normalizedRoot = rootPath ? normalizeReviewPath(rootPath) : ''
  const fileByPath = new Map(files.map(file => [normalizeReviewPath(file.path), file.path]))
  const fileByRelativePath = new Map(
    files.map(file => [normalizeReviewPath(file.relativePath), file.path])
  )

  return changes.map((change) => {
    const normalizedPath = normalizeReviewPath(change.filePath)
    const exactFilePath = fileByPath.get(normalizedPath)
    if (exactFilePath) {
      return exactFilePath === change.filePath ? change : { ...change, filePath: exactFilePath }
    }

    const rootRelativePath = normalizedRoot
      ? stripRootPath(normalizedPath, normalizedRoot)
      : normalizedPath
    const relativeCandidates = [
      rootRelativePath,
      stripDiffSidePrefix(rootRelativePath),
      stripDiffSidePrefix(normalizedPath),
    ]

    for (const candidate of relativeCandidates) {
      const matchedFilePath = fileByRelativePath.get(normalizeReviewPath(candidate))
      if (matchedFilePath) {
        return { ...change, filePath: matchedFilePath }
      }
    }

    if (normalizedRoot && !isAbsoluteReviewPath(normalizedPath)) {
      return { ...change, filePath: joinRootPath(normalizedRoot, stripDiffSidePrefix(normalizedPath)) }
    }

    return normalizedPath === change.filePath ? change : { ...change, filePath: normalizedPath }
  })
}

export function getPendingChangesForFile(
  changes: FileChange[],
  statusByChangeId: NovelReviewStatusMap,
  filePath?: string | null,
): FileChange[] {
  if (!filePath) return []

  return changes.filter(change =>
    change.filePath === filePath
    && !change.error
    && (statusByChangeId[change.id] ?? 'pending') === 'pending'
  )
}

export function getPendingChangedFilePaths(
  changes: FileChange[],
  statusByChangeId: NovelReviewStatusMap,
): string[] {
  const paths: string[] = []
  const seen = new Set<string>()

  for (const change of changes) {
    if (change.error) continue
    if ((statusByChangeId[change.id] ?? 'pending') !== 'pending') continue
    if (seen.has(change.filePath)) continue
    seen.add(change.filePath)
    paths.push(change.filePath)
  }

  return paths
}

export function getAdjacentChangedFilePath(
  filePaths: string[],
  currentFilePath: string | null | undefined,
  direction: 'next' | 'previous',
): string | null {
  if (filePaths.length === 0) return null

  const currentIndex = currentFilePath ? filePaths.indexOf(currentFilePath) : -1
  if (currentIndex === -1) return filePaths[0] ?? null

  const offset = direction === 'next' ? 1 : -1
  const nextIndex = (currentIndex + offset + filePaths.length) % filePaths.length
  return filePaths[nextIndex] ?? null
}
