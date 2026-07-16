// input: Successful workspace file mutations and active workspace configuration
// output: Targeted runtime invalidation for config files with live consumers
// pos: Shared side-effect bridge used by file write, delete, rename, and move handlers

import { relative } from 'path'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { HandlerDeps } from '../handler-deps'

export function notifyConfigWatcherForWrite(
  deps: HandlerDeps,
  workspaceId: string | null | undefined,
  safePath: string,
): void {
  if (!workspaceId) return

  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) return

  const relativePath = relative(workspace.rootPath, safePath).replace(/\\/g, '/')
  if (relativePath === 'automations.json') {
    deps.sessionManager.notifyConfigFileChange(workspace.rootPath, relativePath)
  }
}
