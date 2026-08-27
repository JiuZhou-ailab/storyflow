// input: A tracked Session, a delayed Pi runtime factory, and a concurrent invalidation
// output: Regression proof that invalidation wins before a newly-created runtime receives work
// pos: Guards the Session runtime lease linearization point around async Pi creation

import { describe, expect, it } from 'bun:test'
import { AgentRuntimeLease } from './agent-runtime-lease.ts'
import type { AgentInstance, ManagedSession } from './managed-session.ts'

describe('AgentRuntimeLease', () => {
  it('rechecks invalidation after async runtime creation', async () => {
    let markFactoryStarted!: () => void
    let finishFactory!: () => void
    const factoryStarted = new Promise<void>(resolve => { markFactoryStarted = resolve })
    const factoryGate = new Promise<void>(resolve => { finishFactory = resolve })
    const managed = {
      id: 'session-1',
      runtimeEpoch: 0,
      agent: null,
    } as unknown as ManagedSession
    const lease = new AgentRuntimeLease({
      isSessionTracked: candidate => candidate === managed,
      getOrCreateAgent: async () => {
        markFactoryStarted()
        await factoryGate
        return {} as AgentInstance
      },
    })
    let workStarted = false
    const operation = lease.withAgentRuntimeLease(managed, async () => {
      workStarted = true
    })
    await factoryStarted

    managed.runtimeState = 'invalidating'
    managed.runtimeEpoch = 1
    let invalidationRan = false
    const invalidation = lease.withAgentRuntimeLock(managed, async () => {
      invalidationRan = true
    }, true)

    finishFactory()
    await expect(operation).rejects.toThrow('closing')
    await invalidation
    expect(workStarted).toBe(false)
    expect(invalidationRan).toBe(true)
  })
})
