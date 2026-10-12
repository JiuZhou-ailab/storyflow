// input: Startup draft snapshot, trusted native file grants, and host/workspace context
// output: Canonical process-lifetime attachment authorization for local desktop workspaces
// pos: Shared read/write guard; remote hosts retain their existing attachment behavior
import { realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { getAllSessionDrafts } from '@craft-agent/shared/config'
import { resolveRuntimeWorkspaceById } from '@craft-agent/shared/workspaces'
import type { RequestContext } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { resolveContextWorkspaceId } from './file-workspace-scope'

const trustedPaths = new Set<string>()
let initialized = false

function canonicalPath(path: string): string | null {
  if (typeof path !== 'string' || !isAbsolute(path)) return null
  try {
    return realpathSync(resolve(path))
  } catch {
    return null // Missing, inaccessible, or broken-link attachments cannot be granted.
  }
}

export function registerTrustedUserAttachment(path: string): boolean {
  const canonical = canonicalPath(path)
  if (!canonical) return false
  trustedPaths.add(canonical)
  return true
}

export function initializeUserAttachmentAuthorization(): void {
  if (initialized) return
  initialized = true
  // Migration trust: pre-startup disk refs are grandfathered in; inline content never grants disk access.
  // Remove this import when the supported upgrade baseline has durable attachment provenance.
  for (const draft of Object.values(getAllSessionDrafts())) {
    for (const ref of draft.attachments ?? []) {
      if (!ref.content) registerTrustedUserAttachment(ref.path)
    }
  }
}

export function resolveAuthorizedUserAttachment(path: string): string | null {
  const canonical = canonicalPath(path)
  return canonical && trustedPaths.has(canonical) ? canonical : null
}

export function requiresUserAttachmentAuthorization(ctx: RequestContext, deps: HandlerDeps): boolean {
  if (!initialized) return false
  const workspaceId = resolveContextWorkspaceId(ctx, deps)
  const workspace = workspaceId
    ? deps.resolveRuntimeWorkspaceById?.(workspaceId) ?? resolveRuntimeWorkspaceById(workspaceId)
    : null
  // shortcut: remote grants and draft storage belong to other processes; preserve the legacy
  // boundary until a cross-host file capability protocol can carry native provenance safely.
  return !workspace?.remoteServer
}
