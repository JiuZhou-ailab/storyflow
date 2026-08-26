// input: Global and workspace-scoped waiters against a controllable init gate
// output: Regression coverage for ADR 0013 workspace-scoped session-runtime readiness
// pos: Guards the readiness contract that keeps one project's entry off other projects' histories

import { describe, expect, it } from 'bun:test'
import { InitGate } from './init-gate'
import { orderWorkspacesByActiveFirst } from './workspace-load-order'

/** Resolves once the microtask queue drains, so pending-ness is observable. */
function settled<T>(promise: Promise<T>): Promise<'pending' | 'resolved' | 'rejected'> {
  return Promise.race([
    promise.then(() => 'resolved' as const, () => 'rejected' as const),
    Promise.resolve().then(() => Promise.resolve()).then(() => 'pending' as const),
  ])
}

describe('InitGate workspace scoping', () => {
  it('opens one workspace without opening others or the global gate', async () => {
    const gate = new InitGate()
    const active = gate.waitFor('workspace-active')
    const other = gate.waitFor('workspace-other')
    const global = gate.wait()

    gate.markScopeReady('workspace-active')

    expect(await settled(active)).toBe('resolved')
    expect(await settled(other)).toBe('pending')
    expect(await settled(global)).toBe('pending')
  })

  it('opens a workspace for waiters that arrive after it was marked ready', async () => {
    const gate = new InitGate()
    gate.markScopeReady('workspace-active')
    expect(await settled(gate.waitFor('workspace-active'))).toBe('resolved')
  })

  it('releases every workspace when global discovery completes', async () => {
    const gate = new InitGate()
    const never = gate.waitFor('workspace-never-reported')
    expect(await settled(never)).toBe('pending')

    gate.markReady()

    expect(await settled(never)).toBe('resolved')
    // A workspace discovery never saw must not hang once discovery is done.
    expect(await settled(gate.waitFor('workspace-unknown'))).toBe('resolved')
  })

  it('fails scoped waiters with the same error as global ones', async () => {
    const gate = new InitGate()
    const scoped = gate.waitFor('workspace-active')
    const global = gate.wait()

    gate.markFailed(new Error('discovery failed'))

    expect(await settled(scoped)).toBe('rejected')
    expect(await settled(global)).toBe('rejected')
    // Late scoped waiters must observe the failure too, never hang.
    expect(await settled(gate.waitFor('workspace-late'))).toBe('rejected')
    await expect(scoped).rejects.toThrow('discovery failed')
  })

  it('isolates one failed workspace from healthy workspace shards', async () => {
    const gate = new InitGate()
    const broken = gate.waitFor('workspace-broken')
    const healthy = gate.waitFor('workspace-healthy')

    gate.markScopeFailed('workspace-broken', new Error('unsafe session store'))
    gate.markScopeReady('workspace-healthy')

    await expect(broken).rejects.toThrow('unsafe session store')
    expect(await settled(healthy)).toBe('resolved')
    expect(await settled(gate.wait())).toBe('pending')

    gate.markReady()
    await expect(gate.waitFor('workspace-broken')).rejects.toThrow('unsafe session store')
  })

  it('records a scoped reload failure after global discovery and clears it on retry', async () => {
    const gate = new InitGate()
    gate.markReady()

    gate.markScopeFailed('workspace-late', new Error('late store failure'))
    await expect(gate.waitFor('workspace-late')).rejects.toThrow('late store failure')

    gate.markScopeReady('workspace-late')
    expect(await settled(gate.waitFor('workspace-late'))).toBe('resolved')
  })

  it('treats a missing scope as the global gate', async () => {
    const gate = new InitGate()
    const unscoped = gate.waitFor(null)
    const scoped = gate.waitFor('workspace-active')

    gate.markScopeReady('workspace-active')

    expect(await settled(scoped)).toBe('resolved')
    // No single owning workspace → original global guarantee.
    expect(await settled(unscoped)).toBe('pending')

    gate.markReady()
    expect(await settled(unscoped)).toBe('resolved')
  })
})

describe('orderWorkspacesByActiveFirst', () => {
  const workspaces = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('moves the active workspace to the front and keeps the rest in order', () => {
    expect(orderWorkspacesByActiveFirst(workspaces, 'c')).toEqual([{ id: 'c' }, { id: 'a' }, { id: 'b' }])
  })

  it('is a no-op when the active workspace is absent, already first, or unset', () => {
    expect(orderWorkspacesByActiveFirst(workspaces, 'a')).toEqual(workspaces)
    expect(orderWorkspacesByActiveFirst(workspaces, 'missing')).toEqual(workspaces)
    expect(orderWorkspacesByActiveFirst(workspaces, null)).toEqual(workspaces)
  })

  it('does not mutate the input', () => {
    const input = [{ id: 'a' }, { id: 'b' }]
    orderWorkspacesByActiveFirst(input, 'b')
    expect(input).toEqual([{ id: 'a' }, { id: 'b' }])
  })
})
