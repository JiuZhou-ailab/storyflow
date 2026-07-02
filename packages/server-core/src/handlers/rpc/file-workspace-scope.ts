// input: RPC request context, workspace ids, and absolute filesystem paths
// output: Workspace-root scoped path validation helpers
// pos: Shared guard for file CRUD/search handlers that must stay inside the active project

import { realpath } from 'fs/promises'
import { resolve } from 'path'
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

async function getRootComparablePaths(rootPath: string): Promise<string[]> {
  const rawRootPath = normalizeRootComparablePath(rootPath)
  try {
    const realRootPath = normalizeRootComparablePath(await realpath(rootPath))
    return realRootPath === rawRootPath ? [rawRootPath] : [rawRootPath, realRootPath]
  } catch {
    return [rawRootPath]
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

  const rootPaths = await getRootComparablePaths(workspace.rootPath)
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

export async function validateWorkspaceSearchBasePath(ctx: RequestContext, deps: HandlerDeps, path: string): Promise<string> {
  if (!resolveContextWorkspaceId(ctx, deps)) return path
  return validateWorkspaceFilePath(ctx, deps, path)
}
