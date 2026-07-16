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
  resolveContextWorkspaceId,
  validateWorkspaceMutationPath,
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

function rejectWorkspaceRoot(path: string, rootPath: string): void {
  if (normalizeComparablePath(path) === normalizeComparablePath(rootPath)) {
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
  const sourcePath = await validateWorkspaceMutationPath(ctx, deps, input.sourcePath)
  const destinationDirectoryPath = await validateWorkspaceMutationPath(ctx, deps, input.destinationDirectoryPath)
  rejectWorkspaceRoot(sourcePath, rootPath)

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
    const isSameEntry = destinationStat.dev === sourceStat.dev && destinationStat.ino === sourceStat.ino
    if (!isSameEntry) throw new Error('An entry already exists at the destination path')
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
      throw error
    }
  }

  // Keep the move atomic. Cross-device EXDEV failures intentionally surface
  // instead of falling back to a copy/delete sequence.
  await rename(sourcePath, destinationPath)
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
  const path = await validateWorkspaceMutationPath(ctx, deps, input.path)
  rejectWorkspaceRoot(path, rootPath)

  const pathStat = await lstat(path)
  rejectSymlink(pathStat)
  const type = entryType(pathStat)

  if (type === 'directory') {
    if (input.recursive === true) await rm(path, { recursive: true, force: false })
    else await rmdir(path)
  } else {
    await unlink(path)
  }

  notifyConfigWatcherForWrite(deps, workspaceId, path)
  return { path, type }
}

export function registerWorkspaceFileMutationHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.file.MOVE_ENTRY, (ctx, input: MoveWorkspaceEntryInput) => (
    moveWorkspaceEntry(ctx, deps, input)
  ))
  server.handle(RPC_CHANNELS.file.DELETE_ENTRY, (ctx, input: DeleteWorkspaceEntryInput) => (
    deleteWorkspaceEntry(ctx, deps, input)
  ))
}
