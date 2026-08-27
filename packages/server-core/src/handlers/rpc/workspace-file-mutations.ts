// input: Workspace-scoped move/delete requests and the shared filesystem path guards
// output: Atomic file-tree mutation RPC handlers with old/new path results
// pos: Filesystem mutation boundary for Finder-style workspace tree interactions

import { lstat, rename, rm, rmdir, unlink } from 'fs/promises'
import { basename, join, resolve } from 'path'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import {
  RPC_CHANNELS,
  type DeleteWorkspaceEntryInput,
  type DeleteWorkspaceEntryResult,
  type MoveWorkspaceEntryInput,
  type MoveWorkspaceEntryResult,
} from '@craft-agent/shared/protocol'
import type { RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  getWorkspaceRootComparablePaths,
  resolveContextWorkspaceId,
  validateWorkspaceMutationPath,
  withWorkspaceMutation,
} from './file-workspace-scope'
import { notifyConfigWatcherForWrite } from './workspace-file-effects'

export const WORKSPACE_FILE_MUTATION_CHANNELS = [
  RPC_CHANNELS.file.MOVE_ENTRY,
  RPC_CHANNELS.file.DELETE_ENTRY,
] as const

function normalizeComparablePath(path: string): string {
  const normalized = resolve(path).replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' || process.platform === 'darwin'
    ? normalized.toLocaleLowerCase('en-US')
    : normalized
}

function isSameOrChildPath(path: string, rootPath: string): boolean {
  return path === rootPath || path.startsWith(`${rootPath}/`)
}

function requireWorkspaceRootPath(ctx: RequestContext, deps: HandlerDeps): {
  workspaceId: string
  rootPath: string
} {
  const workspaceId = resolveContextWorkspaceId(ctx, deps)
  if (!workspaceId) throw new Error('Workspace context is required for file tree mutations')

  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return { workspaceId, rootPath: workspace.rootPath }
}

function validateEntryName(name: string): string {
  if (!name || name === '.' || name === '..' || /[\\/\0-\x1f\x7f]/.test(name)) {
    throw new Error('Entry name must be a single valid path segment')
  }
  if (process.platform === 'win32') {
    if (/[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) {
      throw new Error('Entry name is reserved on Windows')
    }
  }
  return name
}

function entryType(entryStat: Awaited<ReturnType<typeof lstat>>): 'file' | 'directory' {
  return entryStat.isDirectory() ? 'directory' : 'file'
}

function isSameEntry(
  left: Awaited<ReturnType<typeof lstat>>,
  right: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function rejectWorkspaceRoot(path: string, rootPaths: readonly string[]): void {
  const comparablePath = normalizeComparablePath(path)
  if (rootPaths.some(rootPath => comparablePath === normalizeComparablePath(rootPath))) {
    throw new Error('Workspace root cannot be moved or deleted')
  }
}

function rejectSymlink(entryStat: Awaited<ReturnType<typeof lstat>>): void {
  if (entryStat.isSymbolicLink()) {
    throw new Error('Symbolic links cannot be moved or deleted from the workspace tree')
  }
}

async function moveWorkspaceEntry(
  ctx: RequestContext,
  deps: HandlerDeps,
  input: MoveWorkspaceEntryInput,
): Promise<MoveWorkspaceEntryResult> {
  if (!input || typeof input.sourcePath !== 'string' || typeof input.destinationDirectoryPath !== 'string') {
    throw new Error('Invalid workspace entry move request')
  }

  const { workspaceId, rootPath } = requireWorkspaceRootPath(ctx, deps)
  const rootPaths = await getWorkspaceRootComparablePaths(rootPath)
  const sourcePath = await validateWorkspaceMutationPath(ctx, deps, input.sourcePath)
  const destinationDirectoryPath = await validateWorkspaceMutationPath(ctx, deps, input.destinationDirectoryPath)
  rejectWorkspaceRoot(sourcePath, rootPaths)

  const sourceStat = await lstat(sourcePath)
  rejectSymlink(sourceStat)

  const destinationDirectoryStat = await lstat(destinationDirectoryPath)
  rejectSymlink(destinationDirectoryStat)
  if (!destinationDirectoryStat.isDirectory()) {
    throw new Error('Move destination must be an existing directory')
  }

  const name = validateEntryName(input.newName ?? basename(sourcePath))
  const destinationPath = await validateWorkspaceMutationPath(ctx, deps, join(destinationDirectoryPath, name))
  const comparableSourcePath = normalizeComparablePath(sourcePath)
  const comparableDestinationPath = normalizeComparablePath(destinationPath)

  if (comparableSourcePath === comparableDestinationPath && sourcePath === destinationPath) {
    return { sourcePath, destinationPath, type: entryType(sourceStat) }
  }
  if (
    sourceStat.isDirectory()
    && comparableDestinationPath !== comparableSourcePath
    && isSameOrChildPath(comparableDestinationPath, comparableSourcePath)
  ) {
    throw new Error('A directory cannot be moved into itself or one of its descendants')
  }

  try {
    const destinationStat = await lstat(destinationPath)
    if (!isSameEntry(destinationStat, sourceStat)) {
      throw new Error('An entry already exists at the destination path')
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
      throw error
    }
  }

  // Keep the move atomic. Cross-device EXDEV failures intentionally surface
  // instead of falling back to a copy/delete sequence.
  // Revalidate immediately before mutation so an ancestor rebound through a
  // symlink after the initial checks fails closed. This narrows, but cannot
  // eliminate, the OS-level race between the final checks and rename().
  await validateWorkspaceMutationPath(ctx, deps, destinationDirectoryPath)
  await validateWorkspaceMutationPath(ctx, deps, destinationPath)
  const revalidatedSourcePath = await validateWorkspaceMutationPath(ctx, deps, sourcePath)
  rejectWorkspaceRoot(revalidatedSourcePath, rootPaths)
  const revalidatedSourceStat = await lstat(revalidatedSourcePath)
  rejectSymlink(revalidatedSourceStat)
  if (!isSameEntry(revalidatedSourceStat, sourceStat)) {
    throw new Error('Move source changed during validation')
  }

  await rename(revalidatedSourcePath, destinationPath)
  notifyConfigWatcherForWrite(deps, workspaceId, sourcePath)
  notifyConfigWatcherForWrite(deps, workspaceId, destinationPath)
  return { sourcePath, destinationPath, type: entryType(sourceStat) }
}

async function deleteWorkspaceEntry(
  ctx: RequestContext,
  deps: HandlerDeps,
  input: DeleteWorkspaceEntryInput,
): Promise<DeleteWorkspaceEntryResult> {
  if (!input || typeof input.path !== 'string') {
    throw new Error('Invalid workspace entry delete request')
  }

  const { workspaceId, rootPath } = requireWorkspaceRootPath(ctx, deps)
  const rootPaths = await getWorkspaceRootComparablePaths(rootPath)
  const path = await validateWorkspaceMutationPath(ctx, deps, input.path)
  rejectWorkspaceRoot(path, rootPaths)

  const pathStat = await lstat(path)
  rejectSymlink(pathStat)
  const type = entryType(pathStat)

  // Revalidate the canonical ancestor and entry identity immediately before
  // mutation. Node does not expose an fd-relative recursive delete primitive,
  // so a kernel-level race remains after this final check.
  const revalidatedPath = await validateWorkspaceMutationPath(ctx, deps, path)
  rejectWorkspaceRoot(revalidatedPath, rootPaths)
  const revalidatedPathStat = await lstat(revalidatedPath)
  rejectSymlink(revalidatedPathStat)
  if (!isSameEntry(revalidatedPathStat, pathStat)) {
    throw new Error('Delete target changed during validation')
  }

  if (type === 'directory') {
    if (input.recursive === true) await rm(revalidatedPath, { recursive: true, force: false })
    else await rmdir(revalidatedPath)
  } else {
    await unlink(revalidatedPath)
  }

  notifyConfigWatcherForWrite(deps, workspaceId, path)
  return { path, type }
}

export function registerWorkspaceFileMutationHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.file.MOVE_ENTRY, (ctx, input: MoveWorkspaceEntryInput) => (
    withWorkspaceMutation(ctx, deps, (_workspaceId, scopedContext) => (
      moveWorkspaceEntry(scopedContext, deps, input)
    ))
  ))
  server.handle(RPC_CHANNELS.file.DELETE_ENTRY, (ctx, input: DeleteWorkspaceEntryInput) => (
    withWorkspaceMutation(ctx, deps, (_workspaceId, scopedContext) => (
      deleteWorkspaceEntry(scopedContext, deps, input)
    ))
  ))
}
