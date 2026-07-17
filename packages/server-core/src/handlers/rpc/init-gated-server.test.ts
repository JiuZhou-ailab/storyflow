// input: A fake RPC transport and a controllable initialization promise
// output: Regression coverage for runtime-gated registration and transport forwarding
// pos: Proves deferred Agent runtime cannot race session-dependent RPC handlers

import { describe, expect, it } from 'bun:test'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types'
import { createInitGatedRpcServer } from './init-gated-server'

const context: RequestContext = {
  clientId: 'client-1',
  workspaceId: 'workspace-1',
  webContentsId: 1,
}

describe('createInitGatedRpcServer', () => {
  it('does not invoke a registered handler before initialization completes', async () => {
    const handlers = new Map<string, HandlerFn>()
    let resolveInit!: () => void
    const init = new Promise<void>((resolve) => { resolveInit = resolve })
    let calls = 0
    const server: RpcServer = {
      handle(channel, handler) { handlers.set(channel, handler) },
      push() {},
      async invokeClient() { return undefined },
    }

    const gated = createInitGatedRpcServer(server, () => init)
    gated.handle('sessions:list', (_ctx, value: string) => {
      calls += 1
      return value
    })

    const result = handlers.get('sessions:list')?.(context, 'ready')
    await Promise.resolve()
    expect(calls).toBe(0)

    resolveInit()
    await expect(result).resolves.toBe('ready')
    expect(calls).toBe(1)
  })

  it('forwards push, client invocation, and workspace routing unchanged', async () => {
    const calls: string[] = []
    const server: RpcServer = {
      handle() {},
      push(channel) { calls.push(`push:${channel}`) },
      async invokeClient(_clientId, channel) {
        calls.push(`invoke:${channel}`)
        return 'response'
      },
      updateClientWorkspace(_clientId, workspaceId) {
        calls.push(`workspace:${workspaceId}`)
      },
    }
    const gated = createInitGatedRpcServer(server, async () => {})

    gated.push('event', { to: 'all' })
    await expect(gated.invokeClient('client-1', 'dialog')).resolves.toBe('response')
    gated.updateClientWorkspace?.('client-1', 'workspace-2')

    expect(calls).toEqual(['push:event', 'invoke:dialog', 'workspace:workspace-2'])
  })
})
