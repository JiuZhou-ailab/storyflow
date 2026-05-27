// input: Turn watchdog timing helper
// output: Regression coverage for broad turn-level timeout semantics
// pos: Keeps long-running session timeout behavior simple and isolated

import { describe, expect, it } from 'bun:test'
import { SESSION_TURN_IDLE_TIMEOUT_MS, TurnWatchdog } from './turn-watchdog.ts'

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
  it('uses a 30 minute default idle timeout window', () => {
    expect(SESSION_TURN_IDLE_TIMEOUT_MS).toBe(30 * 60 * 1000)
  })

  it('fires idle timeout only after a full idle window without progress', () => {
    const scheduler = new FakeScheduler()
    const timeouts: string[] = []
    const watchdog = new TurnWatchdog({
      idleTimeoutMs: 100,
      hardTimeoutMs: 1_000,
      now: () => scheduler.now,
      setTimeout: scheduler.setTimeout.bind(scheduler),
      clearTimeout: scheduler.clearTimeout.bind(scheduler),
      onTimeout: timeout => timeouts.push(timeout.reason),
    })

    watchdog.start()
    scheduler.advance(90)
    watchdog.markProgress()
    scheduler.advance(90)

    expect(timeouts).toEqual([])

    scheduler.advance(10)

    expect(timeouts).toEqual(['idle'])
  })

  it('fires hard timeout even when progress keeps resetting the idle window', () => {
    const scheduler = new FakeScheduler()
    const timeouts: string[] = []
    const watchdog = new TurnWatchdog({
      idleTimeoutMs: 100,
      hardTimeoutMs: 250,
      now: () => scheduler.now,
      setTimeout: scheduler.setTimeout.bind(scheduler),
      clearTimeout: scheduler.clearTimeout.bind(scheduler),
      onTimeout: timeout => timeouts.push(timeout.reason),
    })

    watchdog.start()
    scheduler.advance(90)
    watchdog.markProgress()
    scheduler.advance(90)
    watchdog.markProgress()
    scheduler.advance(70)

    expect(timeouts).toEqual(['hard'])
  })

  it('does not fire after stop clears pending timers', () => {
    const scheduler = new FakeScheduler()
    const timeouts: string[] = []
    const watchdog = new TurnWatchdog({
      idleTimeoutMs: 100,
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
