// input: Workspace identifiers, paths, config, and platform services
// output: Runtime-aware workspace validation and file-access helper functions
// pos: Shared handler utility boundary for project and hidden application contexts

import { basename, dirname, isAbsolute, join, normalize, sep } from 'path'
import { homedir, tmpdir } from 'os'
import { realpath } from 'fs/promises'
import type { Workspace } from '@craft-agent/shared/config'
import { resolveRuntimeWorkspace } from '@craft-agent/shared/workspaces'
import { loadWorkspaceConfig } from '@craft-agent/shared/workspaces'
import type { PlatformServices } from '../runtime/platform'

/**
 * Get workspace by ID or name, throwing if not found.
 * Use this when a workspace must exist for the operation to proceed.
 */
export function getWorkspaceOrThrow(workspaceId: string): Workspace {
  const workspace = resolveRuntimeWorkspace(workspaceId)
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`)
  }
  return workspace
}

export function buildBackendHostRuntimeContext(platform: PlatformServices) {
  return {
    appRootPath: platform.appRootPath,
    resourcesPath: platform.resourcesPath,
    isPackaged: platform.isPackaged,
  }
}

/**
 * Sanitizes a filename to prevent path traversal and filesystem issues.
 * Removes dangerous characters and limits length.
 */
export function sanitizeFilename(name: string): string {
  return name
    // Remove path separators and traversal patterns
    .replace(/[/\\]/g, '_')
    // Remove Windows-forbidden characters: < > : " | ? *
    .replace(/[<>:"|?*]/g, '_')
    // Remove control characters (ASCII 0-31)
    .replace(/[\x00-\x1f]/g, '')
    // Collapse multiple dots (prevent hidden files and extension tricks)
    .replace(/\.{2,}/g, '.')
    // Remove leading/trailing dots and spaces (Windows issues)
    .replace(/^[.\s]+|[.\s]+$/g, '')
    // Limit length (200 chars is safe for all filesystems)
    .slice(0, 200)
    // Fallback if name is empty after sanitization
    || 'unnamed'
}

/**
 * Resolve allowed directories for a workspace: its root path and configured
 * working directory (if set). Returns an empty array if the workspace is
 * unknown or has no relevant paths.
 */
export function getWorkspaceAllowedDirs(workspaceId?: string | null): string[] {
  if (!workspaceId) return []
  const workspace = resolveRuntimeWorkspace(workspaceId)
  if (!workspace) return []

  const dirs: string[] = [workspace.rootPath]
  const config = loadWorkspaceConfig(workspace.rootPath)
  if (config?.defaults?.workingDirectory) {
    dirs.push(config.defaults.workingDirectory)
  }
  return dirs
}

async function resolveRealPathWithMissingLeaf(filePath: string): Promise<string> {
  let cursor = filePath
  const missingSegments: string[] = []

  while (true) {
    try {
      return join(await realpath(cursor), ...missingSegments.reverse())
    } catch {
      const parent = dirname(cursor)
      if (parent === cursor) return filePath
      missingSegments.push(basename(cursor))
      cursor = parent
    }
  }
}

/**
 * Validates that a file path is within allowed directories to prevent path traversal attacks.
 * Allowed directories: user's home directory, /tmp, and any additional dirs passed by the caller
 * (e.g. workspace root, workspace working directory).
 */
export async function validateFilePath(
  filePath: string,
  additionalAllowedDirs?: string[],
): Promise<string> {
  // Normalize the path to resolve . and .. components
  let normalizedPath = normalize(filePath)

  // Expand ~ to home directory
  if (normalizedPath.startsWith('~')) {
    normalizedPath = normalizedPath.replace(/^~/, homedir())
  }

  // Must be an absolute path
  if (!isAbsolute(normalizedPath)) {
    throw new Error('Only absolute file paths are allowed')
  }

  const realFilePath = await resolveRealPathWithMissingLeaf(normalizedPath)

  const normalizedReal = normalize(realFilePath)
  const allowedDirs = [homedir(), tmpdir(), ...(additionalAllowedDirs ?? [])]
    .filter(Boolean)
    .map(dir => normalize(dir))
  const isWithinAllowedDir = (dir: string) => {
    const normalizedDir = normalize(dir)
    return normalizedReal.startsWith(normalizedDir + sep) || normalizedReal === normalizedDir
  }

  // Most callers already provide canonical workspace roots. Only resolve the
  // allowed directories when their lexical paths do not cover the real target.
  let isAllowed = allowedDirs.some(isWithinAllowedDir)
  if (!isAllowed) {
    const realAllowedDirs = await Promise.all(
      allowedDirs.map(dir => resolveRealPathWithMissingLeaf(dir)),
    )
    isAllowed = realAllowedDirs.some(isWithinAllowedDir)
  }

  if (!isAllowed) {
    throw new Error('Access denied: file path is outside allowed directories')
  }

  // Block sensitive files even within allowed directories.
  // Use [\\/] to match both Unix / and Windows \ separators.
  const sensitivePatterns = [
    /\.ssh[\\/]/,
    /\.gnupg[\\/]/,
    /\.aws[\\/]credentials/,
    /\.env$/,
    /\.env\./,
    /credentials\.json$/,
    /secrets?\./i,
    /\.pem$/,
    /\.key$/,
  ]

  if (sensitivePatterns.some(pattern => pattern.test(realFilePath))) {
    throw new Error('Access denied: cannot read sensitive files')
  }

  return realFilePath
}
