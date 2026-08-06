// input: Turn progress timestamps and timeout callbacks
// output: A small watchdog for broad session-turn timeout enforcement
// pos: Isolates long-running turn timeout policy from SessionManager orchestration

export const SESSION_TURN_IDLE_TIMEOUT_MS = 30 * 60 * 1000
export const SESSION_TURN_HARD_TIMEOUT_MS = 12 * 60 * 60 * 1000

export type TurnWatchdogTimeoutReason = 'idle' | 'hard'

export interface TurnWatchdogTimeout {
  reason: TurnWatchdogTimeoutReason
  elapsedMs: number
  idleMs: number
}

type TimerHandle = unknown

interface TurnWatchdogOptions {
  idleTimeoutMs: number
  hardTimeoutMs: number
  onTimeout: (timeout: TurnWatchdogTimeout) => void
  now?: () => number
  setTimeout?: (callback: () => void, ms: number) => TimerHandle
  clearTimeout?: (handle: TimerHandle) => void
}

export class TurnWatchdog {
  private readonly idleTimeoutMs: number
  private readonly hardTimeoutMs: number
  private readonly onTimeout: (timeout: TurnWatchdogTimeout) => void
  private readonly now: () => number
  private readonly setTimer: (callback: () => void, ms: number) => TimerHandle
  private readonly clearTimer: (handle: TimerHandle) => void

  private startedAt = 0
  private lastProgressAt = 0
  private idleTimer: TimerHandle | null = null
  private hardTimer: TimerHandle | null = null
  private started = false
  private stopped = false
  private timeout: TurnWatchdogTimeout | null = null

  constructor(options: TurnWatchdogOptions) {
    this.idleTimeoutMs = options.idleTimeoutMs
    this.hardTimeoutMs = options.hardTimeoutMs
    this.onTimeout = options.onTimeout
    this.now = options.now ?? Date.now
    this.setTimer = options.setTimeout ?? ((callback, ms) => setTimeout(callback, ms))
    this.clearTimer = options.clearTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  start(): void {
    if (this.started) return

    const now = this.now()
    this.started = true
    this.stopped = false
    this.startedAt = now
    this.lastProgressAt = now
    this.scheduleIdleTimer()
    this.hardTimer = this.setTimer(() => this.fire('hard'), this.hardTimeoutMs)
  }

  markProgress(): void {
    if (!this.started || this.stopped || this.timeout) return

    this.lastProgressAt = this.now()
    this.scheduleIdleTimer()
  }

  stop(): void {
    if (this.stopped) return

    this.stopped = true
    this.clearTimers()
  }

  getTimeout(): TurnWatchdogTimeout | null {
    return this.timeout
  }

  private scheduleIdleTimer(): void {
    if (this.idleTimer) {
      this.clearTimer(this.idleTimer)
    }
    this.idleTimer = this.setTimer(() => this.fire('idle'), this.idleTimeoutMs)
  }

  private fire(reason: TurnWatchdogTimeoutReason): void {
    if (this.stopped || this.timeout) return

    const now = this.now()
    this.timeout = {
      reason,
      elapsedMs: Math.max(0, now - this.startedAt),
      idleMs: Math.max(0, now - this.lastProgressAt),
    }
    this.stopped = true
    this.clearTimers()
    this.onTimeout(this.timeout)
  }

  private clearTimers(): void {
    if (this.idleTimer) {
      this.clearTimer(this.idleTimer)
      this.idleTimer = null
    }
    if (this.hardTimer) {
      this.clearTimer(this.hardTimer)
      this.hardTimer = null
    }
  }
}
