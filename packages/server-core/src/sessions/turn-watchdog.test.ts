// input: Turn watchdog hard-limit helper
// output: Regression coverage for absolute turn timeout semantics
// pos: Prevents event silence from being misclassified as failure

import { describe, expect, it } from 'bun:test'
import { SESSION_TURN_HARD_TIMEOUT_MS, TurnWatchdog } from './turn-watchdog.ts'

type TimerCallback = () => void

class FakeScheduler {
  now = 0
  private nextId = 1
  private timers = new Map<number, { dueAt: number; callback: TimerCallback }>()

  setTimeout(callback: TimerCallback, ms: number): number {
    const id = this.nextId++
    this.timers.set(id, { dueAt: this.now + ms, callback })
    return id
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number)
  }

  advance(ms: number): void {
    this.now += ms
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.dueAt <= this.now)
        .sort((a, b) => a[1].dueAt - b[1].dueAt)

      if (due.length === 0) return

      const [id, timer] = due[0]!
      this.timers.delete(id)
      timer.callback()
    }
  }
}

describe('TurnWatchdog', () => {
  it('keeps a twelve-hour absolute safety limit', () => {
    expect(SESSION_TURN_HARD_TIMEOUT_MS).toBe(12 * 60 * 60 * 1000)
  })

  it('does not infer a failed turn from event silence alone', () => {
    const scheduler = new FakeScheduler()
    const timeouts: string[] = []
    const watchdog = new TurnWatchdog({
      hardTimeoutMs: 1_000,
      now: () => scheduler.now,
      setTimeout: scheduler.setTimeout.bind(scheduler),
      clearTimeout: scheduler.clearTimeout.bind(scheduler),
      onTimeout: timeout => timeouts.push(timeout.reason),
    })

    watchdog.start()
    scheduler.advance(999)

    expect(timeouts).toEqual([])
  })

  it('fires only at the absolute safety limit', () => {
    const scheduler = new FakeScheduler()
    const timeouts: Array<{ reason: string; elapsedMs: number }> = []
    const watchdog = new TurnWatchdog({
      hardTimeoutMs: 250,
      now: () => scheduler.now,
      setTimeout: scheduler.setTimeout.bind(scheduler),
      clearTimeout: scheduler.clearTimeout.bind(scheduler),
      onTimeout: timeout => timeouts.push(timeout),
    })

    watchdog.start()
    scheduler.advance(250)

    expect(timeouts).toEqual([{ reason: 'hard', elapsedMs: 250 }])
  })

  it('does not fire after stop clears pending timers', () => {
    const scheduler = new FakeScheduler()
    const timeouts: string[] = []
    const watchdog = new TurnWatchdog({
      hardTimeoutMs: 250,
      now: () => scheduler.now,
      setTimeout: scheduler.setTimeout.bind(scheduler),
      clearTimeout: scheduler.clearTimeout.bind(scheduler),
      onTimeout: timeout => timeouts.push(timeout.reason),
    })

    watchdog.start()
    watchdog.stop()
    scheduler.advance(1_000)

    expect(timeouts).toEqual([])
  })
})
