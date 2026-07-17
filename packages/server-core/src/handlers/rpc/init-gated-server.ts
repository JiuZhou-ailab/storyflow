// input: A transport RPC server and the SessionManager initialization gate
// output: An RPC facade that delays registered handlers until runtime initialization completes
// pos: Keeps transport/file-workspace readiness independent from Agent session runtime readiness

import type { RpcServer } from '../../transport/types'

export function createInitGatedRpcServer(
  server: RpcServer,
  waitForInit: () => Promise<void>,
): RpcServer {
  return {
    handle(channel, handler) {
      server.handle(channel, async (ctx, ...args) => {
        await waitForInit()
        return handler(ctx, ...args)
      })
    },
    push(channel, target, ...args) {
      server.push(channel, target, ...args)
    },
    invokeClient(clientId, channel, ...args) {
      return server.invokeClient(clientId, channel, ...args)
    },
    ...(server.updateClientWorkspace && {
      updateClientWorkspace(clientId: string, workspaceId: string) {
        server.updateClientWorkspace?.(clientId, workspaceId)
      },
    }),
  }
}
