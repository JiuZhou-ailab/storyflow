// input: Tool start names, inputs, and workspace path services
// output: Write tool inputs enriched with previous file content when available
// pos: Session event adapter helper for renderer review rollback metadata

import { join, isAbsolute } from 'path'

export interface CaptureWriteOriginalContentOptions {
  toolName: string
  input: Record<string, unknown>
  workspaceRootPath: string
  validatePath: (path: string) => Promise<string>
  readTextFile: (path: string) => Promise<string>
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function hasWriteOriginalMetadata(input: Record<string, unknown>): boolean {
  return 'original' in input
    || 'oldContent' in input
    || 'old_content' in input
    || 'previousContent' in input
    || 'previous_content' in input
}

function getWriteTargetPath(input: Record<string, unknown>): string | undefined {
  return asString(input.file_path) || asString(input.path)
}

function resolveWriteTargetPath(filePath: string, workspaceRootPath: string): string {
  if (isAbsolute(filePath) || filePath.startsWith('~')) return filePath
  return join(workspaceRootPath, filePath)
}

export async function captureWriteOriginalContent({
  toolName,
  input,
  workspaceRootPath,
  validatePath,
  readTextFile,
}: CaptureWriteOriginalContentOptions): Promise<Record<string, unknown>> {
  if (toolName !== 'Write') return input
  if (hasWriteOriginalMetadata(input)) return input
  if (typeof input.content !== 'string') return input

  const filePath = getWriteTargetPath(input)
  if (!filePath) return input

  try {
    const targetPath = resolveWriteTargetPath(filePath, workspaceRootPath)
    const safePath = await validatePath(targetPath)
    return {
      ...input,
      previous_content: await readTextFile(safePath),
    }
  } catch {
    return input
  }
}
