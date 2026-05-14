// input: File change records and local accept/reject status
// output: Pending changed-file projections for the writing workspace review bar
// pos: Pure workflow helper for Cursor-style novel diff review navigation

import type { FileChange } from '@craft-agent/ui'
import type { NovelWorkspaceFile } from './writing-workspace'

export type NovelReviewStatus = 'accepted' | 'rejected'
export type NovelReviewStatusMap = Record<string, NovelReviewStatus>

function stableHash(value: string): string {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index)
  }
  return (hash >>> 0).toString(36)
}

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

export function getNovelReviewChangeKey(change: Pick<FileChange, 'filePath' | 'toolType' | 'original' | 'modified' | 'unifiedDiff'>): string {
  const signature = change.unifiedDiff ?? `${change.original}\u0000${change.modified}`
  return [
    change.toolType,
    normalizeReviewPath(change.filePath),
    stableHash(signature),
  ].join(':')
}

function getNovelReviewStatus(
  statusByChangeId: NovelReviewStatusMap,
  change: Pick<FileChange, 'id' | 'filePath' | 'toolType' | 'original' | 'modified' | 'unifiedDiff'>,
): NovelReviewStatus | undefined {
  return statusByChangeId[getNovelReviewChangeKey(change)] ?? statusByChangeId[change.id]
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
    && getNovelReviewStatus(statusByChangeId, change) == null
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
    if (getNovelReviewStatus(statusByChangeId, change) != null) continue
    if (seen.has(change.filePath)) continue
    seen.add(change.filePath)
    paths.push(change.filePath)
  }

  return paths
}

export function parseNovelReviewStatusMap(
  value: unknown,
  changes?: Pick<FileChange, 'id' | 'filePath' | 'toolType' | 'original' | 'modified' | 'unifiedDiff'>[],
): NovelReviewStatusMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  if (changes) {
    const parsed: NovelReviewStatusMap = {}
    for (const change of changes) {
      const key = getNovelReviewChangeKey(change)
      const status = (value as Record<string, unknown>)[key] ?? (value as Record<string, unknown>)[change.id]
      if (status !== 'accepted' && status !== 'rejected') continue
      parsed[key] = status
    }
    return parsed
  }

  const parsed: NovelReviewStatusMap = {}

  for (const [changeId, status] of Object.entries(value)) {
    if (status !== 'accepted' && status !== 'rejected') continue
    parsed[changeId] = status
  }

  return parsed
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
