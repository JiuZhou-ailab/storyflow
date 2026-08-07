// input: Turn start time and an absolute timeout callback
// output: A small watchdog for the session turn hard safety limit
// pos: Keeps lifecycle safety bounded without guessing progress from event frequency

export const SESSION_TURN_HARD_TIMEOUT_MS = 12 * 60 * 60 * 1000

export interface TurnWatchdogTimeout {
  reason: 'hard'
  elapsedMs: number
}

type TimerHandle = unknown

interface TurnWatchdogOptions {
  hardTimeoutMs: number
  onTimeout: (timeout: TurnWatchdogTimeout) => void
  now?: () => number
  setTimeout?: (callback: () => void, ms: number) => TimerHandle
  clearTimeout?: (handle: TimerHandle) => void
}

export class TurnWatchdog {
  private readonly hardTimeoutMs: number
  private readonly onTimeout: (timeout: TurnWatchdogTimeout) => void
  private readonly now: () => number
  private readonly setTimer: (callback: () => void, ms: number) => TimerHandle
  private readonly clearTimer: (handle: TimerHandle) => void

  private startedAt = 0
  private hardTimer: TimerHandle | null = null
  private started = false
  private stopped = false
  private timeout: TurnWatchdogTimeout | null = null

  constructor(options: TurnWatchdogOptions) {
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
    this.hardTimer = this.setTimer(() => this.fire(), this.hardTimeoutMs)
  }

  stop(): void {
    if (this.stopped) return

    this.stopped = true
    this.clearTimers()
  }

  getTimeout(): TurnWatchdogTimeout | null {
    return this.timeout
  }

  private fire(): void {
    if (this.stopped || this.timeout) return

    const now = this.now()
    this.timeout = {
      reason: 'hard',
      elapsedMs: Math.max(0, now - this.startedAt),
    }
    this.stopped = true
    this.clearTimers()
    this.onTimeout(this.timeout)
  }

  private clearTimers(): void {
    if (this.hardTimer) {
      this.clearTimer(this.hardTimer)
      this.hardTimer = null
    }
  }
}
