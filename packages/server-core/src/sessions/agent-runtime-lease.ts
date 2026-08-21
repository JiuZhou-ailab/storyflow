// input: ManagedSession identity checks and an agent factory callback
// output: withAgentRuntimeLease / withAgentRuntimeLock / beginSessionOperationLease concurrency primitives
// pos: Serializes runtime acquisition and exclusive control-plane mutations per session

import type { AgentInstance, ManagedSession } from './managed-session'

export interface AgentRuntimeLeaseDeps {
  /** True when the session is still present in the Facade registry (not closing/deleted). */
  isSessionTracked(managed: ManagedSession): boolean
  /** Resolve or create the session's Pi subprocess. Resolves through the Facade at call time so per-instance stubs keep working. */
  getOrCreateAgent(managed: ManagedSession): Promise<AgentInstance>
}

/**
 * Per-session runtime concurrency: a mutex serializes exclusive mutations,
 * and reference-counted leases let compatible operations (chat, one-shot
 * queries) share one stable Pi subprocess while refresh/dispose wait them out.
 */
export class AgentRuntimeLease {
  constructor(private deps: AgentRuntimeLeaseDeps) {}

  private agentRuntimeLocks: Map<string, Promise<void>> = new Map()
  /** Active compatible operations sharing one stable Pi subprocess. */
  private agentRuntimeLeaseCounts: Map<string, number> = new Map()
  /** Exclusive mutations wait here until every active operation releases the subprocess. */
  private agentRuntimeLeaseWaiters: Map<string, Set<() => void>> = new Map()

  private assertAgentRuntimeOpen(managed: ManagedSession, expectedEpoch?: number): void {
    if (!this.deps.isSessionTracked(managed) || managed.runtimeState) {
      throw new Error(`Session ${managed.id} is closing`)
    }
    if (expectedEpoch !== undefined && (managed.runtimeEpoch ?? 0) !== expectedEpoch) {
      throw new Error(`Session ${managed.id} runtime was invalidated`)
    }
  }

  private async withAgentRuntimeMutex<T>(
    managed: ManagedSession,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = this.agentRuntimeLocks.get(managed.id) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const slot = previous.catch(() => undefined).then(() => gate)
    this.agentRuntimeLocks.set(managed.id, slot)
    await previous.catch(() => undefined)
    try {
      return await work()
    } finally {
      release()
      if (this.agentRuntimeLocks.get(managed.id) === slot) {
        this.agentRuntimeLocks.delete(managed.id)
      }
    }
  }

  private waitForAgentRuntimeLeases(sessionId: string): Promise<void> {
    if ((this.agentRuntimeLeaseCounts.get(sessionId) ?? 0) === 0) return Promise.resolve()
    return new Promise(resolve => {
      const waiters = this.agentRuntimeLeaseWaiters.get(sessionId) ?? new Set<() => void>()
      waiters.add(resolve)
      this.agentRuntimeLeaseWaiters.set(sessionId, waiters)
    })
  }

  private retainAgentRuntimeLease(sessionId: string): void {
    this.agentRuntimeLeaseCounts.set(sessionId, (this.agentRuntimeLeaseCounts.get(sessionId) ?? 0) + 1)
  }

  private releaseAgentRuntimeLease(sessionId: string): void {
    const remaining = (this.agentRuntimeLeaseCounts.get(sessionId) ?? 1) - 1
    if (remaining > 0) {
      this.agentRuntimeLeaseCounts.set(sessionId, remaining)
      return
    }
    this.agentRuntimeLeaseCounts.delete(sessionId)
    const waiters = this.agentRuntimeLeaseWaiters.get(sessionId)
    this.agentRuntimeLeaseWaiters.delete(sessionId)
    for (const resolve of waiters ?? []) resolve()
  }

  /** Keep short pre-runtime session work ahead of deletion and invalidation. */
  beginSessionOperationLease(managed: ManagedSession): () => void {
    this.assertAgentRuntimeOpen(managed)
    this.retainAgentRuntimeLease(managed.id)
    let retained = true
    return () => {
      if (!retained) return
      retained = false
      this.releaseAgentRuntimeLease(managed.id)
    }
  }

  async withAgentRuntimeLock<T>(
    managed: ManagedSession,
    work: () => Promise<T>,
    allowClosing = false,
  ): Promise<T> {
    if (!allowClosing) this.assertAgentRuntimeOpen(managed)
    return this.withAgentRuntimeMutex(managed, async () => {
      if (!allowClosing) this.assertAgentRuntimeOpen(managed)
      await this.waitForAgentRuntimeLeases(managed.id)
      if (!allowClosing) this.assertAgentRuntimeOpen(managed)
      return work()
    })
  }

  /**
   * Retain one stable Pi subprocess for a compatible operation. Chat and
   * ephemeral llm_query calls may coexist; refresh, rewind, Source mutation,
   * credential changes, and disposal wait for every retained operation.
   */
  async withAgentRuntimeLease<T>(
    managed: ManagedSession,
    work: (agent: AgentInstance) => Promise<T>,
  ): Promise<T> {
    this.assertAgentRuntimeOpen(managed)
    const expectedEpoch = managed.runtimeEpoch ?? 0
    const agent = await this.withAgentRuntimeMutex(managed, async () => {
      this.assertAgentRuntimeOpen(managed, expectedEpoch)
      let agent = managed.agent
      if (
        !agent
        || managed.credentialRestartRequired
        || (this.agentRuntimeLeaseCounts.get(managed.id) ?? 0) === 0
      ) {
        await this.waitForAgentRuntimeLeases(managed.id)
        this.assertAgentRuntimeOpen(managed, expectedEpoch)
        agent = await this.deps.getOrCreateAgent(managed)
      }
      this.retainAgentRuntimeLease(managed.id)
      return agent
    })
    try {
      return await work(agent)
    } finally {
      this.releaseAgentRuntimeLease(managed.id)
    }
  }
}
