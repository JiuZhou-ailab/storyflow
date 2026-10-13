// input: Agent file change records and the Project file catalog
// output: File changes whose paths name Project files, scoped to the Project root
// pos: Pure path projection for agent file changes in the writing workspace

import type { FileChange } from '@craft-agent/ui'
import type { NovelWorkspaceFile } from './writing-workspace'

function normalizeChangePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

function isAbsoluteChangePath(path: string): boolean {
  const normalized = normalizeChangePath(path)
  return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')
}

function joinRootPath(rootPath: string, relativePath: string): string {
  const root = normalizeChangePath(rootPath)
  const relative = normalizeChangePath(relativePath).replace(/^\/+/, '')
  return relative ? `${root}/${relative}` : root
}

function stripRootPath(path: string, rootPath: string): string {
  const normalizedPath = normalizeChangePath(path)
  const normalizedRoot = normalizeChangePath(rootPath)
  if (!normalizedRoot) return normalizedPath
  if (normalizedPath === normalizedRoot) return ''
  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }
  return normalizedPath
}

function isWithinRootPath(path: string, rootPath: string): boolean {
  const normalizedPath = normalizeChangePath(path)
  const normalizedRoot = normalizeChangePath(rootPath)
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

function stripDiffSidePrefix(path: string): string {
  return path.replace(/^(?:a|b)\//, '')
}

export function normalizeNovelFileChangePaths(
  changes: FileChange[],
  rootPath: string | null | undefined,
  files: Pick<NovelWorkspaceFile, 'path' | 'relativePath'>[],
): FileChange[] {
  if (changes.length === 0) return []

  const normalizedRoot = rootPath ? normalizeChangePath(rootPath) : ''
  const fileByPath = new Map(files.map(file => [normalizeChangePath(file.path), file.path]))
  const fileByRelativePath = new Map(
    files.map(file => [normalizeChangePath(file.relativePath), file.path])
  )

  return changes.flatMap((change) => {
    const normalizedPath = normalizeChangePath(change.filePath)
    if (normalizedRoot && isAbsoluteChangePath(normalizedPath) && !isWithinRootPath(normalizedPath, normalizedRoot)) {
      return []
    }

    const exactFilePath = fileByPath.get(normalizedPath)
    if (exactFilePath) {
      return [exactFilePath === change.filePath ? change : { ...change, filePath: exactFilePath }]
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
      const matchedFilePath = fileByRelativePath.get(normalizeChangePath(candidate))
      if (matchedFilePath) {
        return [{ ...change, filePath: matchedFilePath }]
      }
    }

    if (normalizedRoot && !isAbsoluteChangePath(normalizedPath)) {
      return [{ ...change, filePath: joinRootPath(normalizedRoot, stripDiffSidePrefix(normalizedPath)) }]
    }

    return [normalizedPath === change.filePath ? change : { ...change, filePath: normalizedPath }]
  })
}
