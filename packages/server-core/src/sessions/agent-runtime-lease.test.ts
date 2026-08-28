// input: A tracked Session, a delayed Pi runtime factory, and a concurrent invalidation
// output: Regression proof that invalidation wins before a newly-created runtime receives work
// pos: Guards the Session runtime lease linearization point around async Pi creation

import { describe, expect, it } from 'bun:test'
import { AgentRuntimeLease } from './agent-runtime-lease.ts'
import type { AgentInstance, ManagedSession } from './managed-session.ts'

describe('AgentRuntimeLease', () => {
  it('disposes a live Pi runtime when Host Project inputs change', async () => {
    const staleAgent = {} as AgentInstance
    const freshAgent = {} as AgentInstance
    const managed = {
      id: 'session-1',
      runtimeEpoch: 0,
      agent: staleAgent,
    } as unknown as ManagedSession
    let refreshRequired = true
    let disposeCount = 0
    const lease = new AgentRuntimeLease({
      isSessionTracked: candidate => candidate === managed,
      refreshSessionWorkspace: () => {
        const changed = refreshRequired
        refreshRequired = false
        return changed
      },
      revalidateAgentWorkingDirectory: () => false,
      disposeAgentRuntime: async candidate => {
        disposeCount++
        candidate.agent = null
      },
      getOrCreateAgent: async candidate => {
        candidate.agent = freshAgent
        return freshAgent
      },
    })

    let leasedAgent: AgentInstance | undefined
    await lease.withAgentRuntimeLease(managed, async agent => { leasedAgent = agent })

    expect(disposeCount).toBe(1)
    expect(leasedAgent).toBe(freshAgent)
  })

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
      refreshSessionWorkspace: () => false,
      revalidateAgentWorkingDirectory: () => false,
      disposeAgentRuntime: async () => {},
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

  for (const mode of ['shared', 'exclusive'] as const) it(`rebuilds Pi when Project inputs change during async runtime creation (${mode})`, async () => {
    let markFactoryStarted!: () => void
    let finishFactory!: () => void
    const factoryStarted = new Promise<void>(resolve => { markFactoryStarted = resolve })
    const factoryGate = new Promise<void>(resolve => { finishFactory = resolve })
    const firstAgent = {} as AgentInstance
    const secondAgent = {} as AgentInstance
    const managed = {
      id: 'session-1',
      runtimeEpoch: 0,
      agent: null,
      workspace: { id: 'project-1', rootPath: '/old' },
    } as unknown as ManagedSession
    let currentRoot = '/old'
    let factoryCalls = 0
    const disposed: AgentInstance[] = []
    const lease = new AgentRuntimeLease({
      isSessionTracked: candidate => candidate === managed,
      refreshSessionWorkspace: candidate => {
        if (candidate.workspace.rootPath === currentRoot) return false
        candidate.workspace = { ...candidate.workspace, rootPath: currentRoot }
        return true
      },
      revalidateAgentWorkingDirectory: () => false,
      disposeAgentRuntime: async candidate => {
        if (candidate.agent) disposed.push(candidate.agent)
        candidate.agent = null
      },
      getOrCreateAgent: async candidate => {
        factoryCalls++
        const agent = factoryCalls === 1 ? firstAgent : secondAgent
        candidate.agent = agent
        if (factoryCalls === 1) {
          markFactoryStarted()
          await factoryGate
        }
        return agent
      },
    })

    let leasedAgent: AgentInstance | undefined
    const operation = mode === 'shared'
      ? lease.withAgentRuntimeLease(managed, async agent => { leasedAgent = agent })
      : lease.withAgentRuntimeLock(managed, async getOrCreateAgent => {
          leasedAgent = await getOrCreateAgent()
        })
    await factoryStarted

    currentRoot = '/new'
    const release = lease.beginSessionOperationLease(managed)
    release()
    finishFactory()
    await operation

    expect(disposed).toEqual([firstAgent])
    expect(factoryCalls).toBe(2)
    expect(leasedAgent).toBe(secondAgent)
    expect(managed.workspace.rootPath).toBe('/new')
  })

  it('disposes Pi when cwd authorization changes during async runtime creation', async () => {
    let markFactoryStarted!: () => void
    let finishFactory!: () => void
    const factoryStarted = new Promise<void>(resolve => { markFactoryStarted = resolve })
    const factoryGate = new Promise<void>(resolve => { finishFactory = resolve })
    const staleAgent = {} as AgentInstance
    const managed = {
      id: 'session-1',
      runtimeEpoch: 0,
      agent: null,
    } as unknown as ManagedSession
    let cwdValid = true
    let disposed = false
    const lease = new AgentRuntimeLease({
      isSessionTracked: candidate => candidate === managed,
      refreshSessionWorkspace: () => false,
      revalidateAgentWorkingDirectory: () => {
        if (!cwdValid) throw new Error('Working directory is not authorized')
        return false
      },
      disposeAgentRuntime: async candidate => {
        disposed = true
        candidate.agent = null
      },
      getOrCreateAgent: async candidate => {
        candidate.agent = staleAgent
        markFactoryStarted()
        await factoryGate
        return staleAgent
      },
    })

    let workStarted = false
    const operation = lease.withAgentRuntimeLease(managed, async () => { workStarted = true })
    await factoryStarted
    cwdValid = false
    finishFactory()

    await expect(operation).rejects.toThrow('not authorized')
    expect(disposed).toBeTrue()
    expect(workStarted).toBeFalse()
  })
})
