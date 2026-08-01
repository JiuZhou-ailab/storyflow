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

  it('waits only for the requesting workspace when a scope resolver is supplied', async () => {
    // ADR 0013: entering one project must not wait on other projects' histories.
    const handlers = new Map<string, HandlerFn>()
    const opened = new Set<string>()
    const waiters = new Map<string, () => void>()
    const server: RpcServer = {
      handle(channel, handler) { handlers.set(channel, handler) },
      push() {},
      async invokeClient() { return undefined },
    }

    const gated = createInitGatedRpcServer(
      server,
      (scopeId) => {
        const key = scopeId ?? '__global__'
        if (opened.has(key)) return Promise.resolve()
        return new Promise<void>((resolve) => waiters.set(key, resolve))
      },
      (ctx) => ctx.workspaceId,
    )
    gated.handle('sessions:list', () => 'done')

    const own = handlers.get('sessions:list')?.(context, undefined)
    const other = handlers.get('sessions:list')?.(
      { ...context, workspaceId: 'workspace-2' },
      undefined,
    )

    waiters.get('workspace-1')?.()
    await expect(own).resolves.toBe('done')

    let otherSettled = false
    void other?.then(() => { otherSettled = true })
    await Promise.resolve()
    expect(otherSettled).toBe(false)
    // The global gate was never the thing being awaited.
    expect(waiters.has('__global__')).toBe(false)
  })

  it('falls back to the global gate when no scope resolver is supplied', async () => {
    const handlers = new Map<string, HandlerFn>()
    const scopes: Array<string | null | undefined> = []
    const server: RpcServer = {
      handle(channel, handler) { handlers.set(channel, handler) },
      push() {},
      async invokeClient() { return undefined },
    }

    const gated = createInitGatedRpcServer(server, async (scopeId) => { scopes.push(scopeId) })
    gated.handle('sessions:list', () => 'done')
    await handlers.get('sessions:list')?.(context, undefined)

    expect(scopes).toEqual([undefined])
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
