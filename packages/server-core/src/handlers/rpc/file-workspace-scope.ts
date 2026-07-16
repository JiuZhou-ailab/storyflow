// input: RPC request context, workspace ids, and absolute filesystem paths
// output: Workspace-root scoped read/search and symlink-safe mutation path validation helpers
// pos: Shared guard for file CRUD/search handlers that must stay inside the active project

import { realpath } from 'fs/promises'
import { dirname, isAbsolute, resolve } from 'path'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { validateFilePath } from '@craft-agent/server-core/handlers'
import type { RequestContext } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

function isPathInsideRoot(path: string, rootPath: string): boolean {
  return path === rootPath || path.startsWith(`${rootPath}/`)
}

function normalizeRootComparablePath(path: string): string {
  return resolve(path).replace(/\\/g, '/').replace(/\/+$/, '')
}

// ponytail: process-local root cache; add config-triggered invalidation if roots retarget live.
const rootComparablePathCache = new Map<string, Promise<string[]>>()

async function resolveRootComparablePaths(rootPath: string, rawRootPath: string): Promise<string[]> {
  try {
    const realRootPath = normalizeRootComparablePath(await realpath(rootPath))
    return realRootPath === rawRootPath ? [rawRootPath] : [rawRootPath, realRootPath]
  } catch {
    return [rawRootPath]
  }
}

export async function getWorkspaceRootComparablePaths(rootPath: string): Promise<string[]> {
  const rawRootPath = normalizeRootComparablePath(rootPath)
  let cached = rootComparablePathCache.get(rawRootPath)
  if (!cached) {
    cached = resolveRootComparablePaths(rootPath, rawRootPath)
    rootComparablePathCache.set(rawRootPath, cached)
  }
  return cached
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR')
}

async function resolveNearestExistingAncestor(path: string): Promise<string> {
  let candidate = path

  while (true) {
    try {
      return normalizeRootComparablePath(await realpath(candidate))
    } catch (error) {
      if (!isMissingPathError(error)) throw error
      const parent = dirname(candidate)
      if (parent === candidate) throw error
      candidate = parent
    }
  }
}

export function resolveContextWorkspaceId(ctx: RequestContext, deps: HandlerDeps): string | null | undefined {
  return ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
}

export async function validateWorkspaceFilePath(ctx: RequestContext, deps: HandlerDeps, path: string): Promise<string> {
  const workspaceId = resolveContextWorkspaceId(ctx, deps)
  if (!workspaceId) return validateFilePath(path)

  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

  const rootPaths = await getWorkspaceRootComparablePaths(workspace.rootPath)
  let safePath: string
  try {
    safePath = await validateFilePath(path, rootPaths)
  } catch (error) {
    if (error instanceof Error && error.message.includes('Access denied')) {
      throw new Error('Access denied: file path is outside current workspace')
    }
    throw error
  }

  const comparablePath = normalizeRootComparablePath(safePath)
  if (!rootPaths.some((rootPath) => isPathInsideRoot(comparablePath, rootPath))) {
    throw new Error('Access denied: file path is outside current workspace')
  }
  return safePath
}

/**
 * Validate a path that may not exist yet without trusting its lexical prefix.
 * The nearest existing ancestor is resolved so a symlink inside the workspace
 * cannot redirect writes, directory creation, or moves outside the project.
 */
export async function validateWorkspaceMutationPath(ctx: RequestContext, deps: HandlerDeps, path: string): Promise<string> {
  const workspaceId = resolveContextWorkspaceId(ctx, deps)
  if (!workspaceId) return validateFilePath(path)

  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

  const rootPaths = await getWorkspaceRootComparablePaths(workspace.rootPath)
  try {
    // Preserve the shared absolute-path and sensitive-file policy. Its return
    // value may be a realpath, while mutations intentionally target the lexical
    // entry after separately proving its ancestor remains in the workspace.
    await validateFilePath(path, rootPaths)
    const mutationPath = normalizeRootComparablePath(path)
    const existingAncestor = await resolveNearestExistingAncestor(mutationPath)
    if (!rootPaths.some((rootPath) => isPathInsideRoot(existingAncestor, rootPath))) {
      throw new Error('Access denied: file path is outside current workspace')
    }
    return mutationPath
  } catch (error) {
    if (error instanceof Error && error.message.includes('Access denied')) {
      throw new Error('Access denied: file path is outside current workspace')
    }
    throw error
  }
}

export async function validateWorkspaceSearchBasePath(ctx: RequestContext, deps: HandlerDeps, path: string): Promise<string> {
  const workspaceId = resolveContextWorkspaceId(ctx, deps)
  if (!workspaceId) return path
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

  const rootPaths = await getWorkspaceRootComparablePaths(workspace.rootPath)
  const comparablePath = normalizeRootComparablePath(path)
  if (isAbsolute(path) && rootPaths.includes(comparablePath)) return path

  return validateWorkspaceFilePath(ctx, deps, path)
}
