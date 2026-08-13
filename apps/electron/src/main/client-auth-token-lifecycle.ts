// input: Model-token JWTs, auth transitions, and an injectable clock
// output: Operation-safety freshness policy plus single-flight, generation-fenced refresh state
// pos: Main-process lifecycle coordinator beneath client-auth flows and persistence

import { Buffer } from 'node:buffer'

export const CLIENT_MODEL_ACCESS_TOKEN_MIN_REMAINING_MS = (12 * 60 * 60 + 5 * 60) * 1000

export interface ClientAuthTokenLifecycleDeps {
  now?: () => number
}

export function getClientModelAccessTokenExpiryMs(token: string): number | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp)
      ? payload.exp * 1000
      : null
  } catch {
    return null
  }
}

export function isClientModelAccessTokenFresh(
  token: string,
  nowMs: number = Date.now(),
): boolean {
  const expiresAt = getClientModelAccessTokenExpiryMs(token)
  return expiresAt !== null && expiresAt - nowMs > CLIENT_MODEL_ACCESS_TOKEN_MIN_REMAINING_MS
}

/**
 * Owns refresh concurrency and time. Authentication identities and broker I/O
 * remain in client-auth.ts; callers fence every durable state transition here.
 */
export class ClientAuthTokenLifecycle<T> {
  private generationValue = 0
  private persistenceTail: Promise<unknown> = Promise.resolve()
  private inFlight: Promise<T> | null = null
  private disposedValue = false

  constructor(private readonly deps: ClientAuthTokenLifecycleDeps) {}

  get generation(): number {
    return this.generationValue
  }

  get nowMs(): number {
    return this.deps.now?.() ?? Date.now()
  }

  get disposed(): boolean {
    return this.disposedValue
  }

  beginTransition(): number {
    this.generationValue += 1
    this.inFlight = null
    return this.generationValue
  }

  isCurrent(generation: number): boolean {
    return !this.disposedValue && generation === this.generationValue
  }

  assertCurrent(generation: number): void {
    if (!this.isCurrent(generation)) throw new Error('Client auth session changed')
  }

  runExclusive<R>(operation: () => Promise<R>): Promise<R> {
    const pending = this.persistenceTail.then(operation, operation)
    this.persistenceTail = pending.catch(() => undefined)
    return pending
  }

  getPendingRefresh(): Promise<T> | null {
    return this.inFlight
  }

  runSingleFlight(operation: () => Promise<T>): Promise<T> {
    if (this.disposedValue) return Promise.reject(new Error('Client auth service is disposed'))
    if (this.inFlight) return this.inFlight
    const pending = Promise.resolve().then(operation)
    this.inFlight = pending
    return pending.finally(() => {
      if (this.inFlight === pending) this.inFlight = null
    })
  }

  dispose(): void {
    if (this.disposedValue) return
    this.disposedValue = true
    this.beginTransition()
  }
}
