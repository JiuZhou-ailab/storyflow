// input: Status list/reorder RPC requests scoped to a registered Project
// output: Status config IO serialized with Project root lifecycle changes
// pos: RPC boundary for self-healing and mutating Project status storage

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.statuses.LIST,
  RPC_CHANNELS.statuses.REORDER,
] as const

export function registerStatusesHandlers(server: RpcServer, deps: HandlerDeps): void {
  // List all statuses for a workspace
  server.handle(RPC_CHANNELS.statuses.LIST, async (_ctx, workspaceId: string) => {
    return deps.sessionManager.withProjectLifecycle(workspaceId, async workspace => {
      const { listStatuses } = await import('@craft-agent/shared/statuses')
      return listStatuses(workspace.rootPath)
    })
  })

  // Reorder statuses (drag-and-drop). Receives new ordered array of status IDs.
  // Config watcher will detect the file change and broadcast STATUSES_CHANGED.
  server.handle(RPC_CHANNELS.statuses.REORDER, async (_ctx, workspaceId: string, orderedIds: string[]) => {
    return deps.sessionManager.withProjectLifecycle(workspaceId, async workspace => {
      const { reorderStatuses } = await import('@craft-agent/shared/statuses')
      reorderStatuses(workspace.rootPath, orderedIds)
    })
  })
}
