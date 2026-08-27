// input: Label RPC requests scoped to a registered Project
// output: Label reads/mutations serialized with Project root lifecycle changes
// pos: RPC boundary for Project-owned label config and session metadata IO

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.labels.LIST,
  RPC_CHANNELS.labels.CREATE,
  RPC_CHANNELS.labels.DELETE,
] as const

export function registerLabelsHandlers(server: RpcServer, deps: HandlerDeps): void {
  // List all labels for a workspace
  server.handle(RPC_CHANNELS.labels.LIST, async (_ctx, workspaceId: string) => {
    return deps.sessionManager.withProjectLifecycle(workspaceId, async workspace => {
      const { listLabels } = await import('@craft-agent/shared/labels/storage')
      return listLabels(workspace.rootPath)
    })
  })

  // Create a new label in a workspace
  server.handle(RPC_CHANNELS.labels.CREATE, async (_ctx, workspaceId: string, input: import('@craft-agent/shared/labels').CreateLabelInput) => {
    const label = await deps.sessionManager.withProjectLifecycle(workspaceId, async workspace => {
      const { createLabel } = await import('@craft-agent/shared/labels/crud')
      return createLabel(workspace.rootPath, input)
    })
    pushTyped(server, RPC_CHANNELS.labels.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
    return label
  })

  // Delete a label (and descendants) from a workspace
  server.handle(RPC_CHANNELS.labels.DELETE, async (_ctx, workspaceId: string, labelId: string) => {
    const result = await deps.sessionManager.withProjectLifecycle(workspaceId, async workspace => {
      const { deleteLabel } = await import('@craft-agent/shared/labels/crud')
      return deleteLabel(workspace.rootPath, labelId)
    })
    pushTyped(server, RPC_CHANNELS.labels.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
    return result
  })
}
