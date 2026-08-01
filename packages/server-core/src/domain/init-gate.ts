/**
 * Tracks startup initialization state and coordinates async waiters.
 * Waiters are settled exactly once as either ready (resolve) or failed (reject).
 */
export class InitGate {
  private settled = false
  private readonly promise: Promise<void>
  private resolvePromise!: () => void
  private rejectPromise!: (error: unknown) => void
  private readonly shards = new Map<string, InitGate>()

  constructor() {
    this.promise = new Promise<void>((resolve, reject) => {
      this.resolvePromise = resolve
      this.rejectPromise = reject
    })
    // An unobserved rejection here is expected: shards and the global gate are
    // often never awaited by anyone when startup fails early.
    this.promise.catch(() => {})
  }

  wait(): Promise<void> {
    return this.promise
  }

  /**
   * Waits only for one workspace's slice of session-runtime readiness (ADR 0013).
   *
   * Falls back to the global gate once it is settled, so callers that arrive after
   * full initialization never allocate a shard, and a workspace that discovery
   * never reports (unknown id, removed directory) still resolves instead of hanging.
   */
  waitFor(scopeId: string | null | undefined): Promise<void> {
    if (!scopeId) return this.wait()
    if (this.settled) return this.promise
    return this.shard(scopeId).wait()
  }

  /** Opens one workspace's shard as soon as its sessions are indexed. */
  markScopeReady(scopeId: string): void {
    if (this.settled) return
    this.shard(scopeId).markReady()
  }

  markReady(): void {
    if (this.settled) return
    this.settled = true
    // Any workspace not individually reported is ready once discovery completes.
    for (const shard of this.shards.values()) shard.markReady()
    this.resolvePromise()
  }

  markFailed(error: unknown): void {
    if (this.settled) return
    this.settled = true
    // Scoped waiters must observe the same failure as global ones, never hang.
    for (const shard of this.shards.values()) shard.markFailed(error)
    this.rejectPromise(error)
  }

  private shard(scopeId: string): InitGate {
    let shard = this.shards.get(scopeId)
    if (!shard) {
      shard = new InitGate()
      this.shards.set(scopeId, shard)
    }
    return shard
  }
}
