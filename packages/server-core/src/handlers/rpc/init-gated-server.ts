// input: A transport RPC server and the SessionManager initialization gate
// output: An RPC facade that delays registered handlers until runtime initialization completes
// pos: Keeps transport/file-workspace readiness independent from Agent session runtime readiness

import type { RpcServer, RequestContext } from '../../transport/types'

/**
 * Resolves the workspace a request belongs to, or null when it has no single owner.
 * Kept as a parameter so this module stays free of HandlerDeps/windowManager imports.
 */
export type ResolveRequestScope = (ctx: RequestContext) => string | null | undefined

export function createInitGatedRpcServer(
  server: RpcServer,
  waitForInit: (scopeId?: string | null) => Promise<void>,
  resolveScope?: ResolveRequestScope,
): RpcServer {
  return {
    handle(channel, handler) {
      server.handle(channel, async (ctx, ...args) => {
        // ADR 0013: wait for this request's workspace slice, not global discovery.
        // Without a resolver — or for requests with no single owning workspace —
        // this degrades to the original global gate.
        const scopeId = resolveScope ? resolveScope(ctx) : undefined
        await waitForInit(scopeId)
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
