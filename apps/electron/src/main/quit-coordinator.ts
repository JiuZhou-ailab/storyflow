// input: Electron quit state plus application cleanup and exit callbacks
// output: Idempotent, deadline-bounded quit preparation and updater-safe before-quit handling
// pos: Owns the boundary between Storyflow cleanup and Electron's native quit flow

interface BeforeQuitEvent {
  preventDefault(): void
}

interface QuitCoordinatorOptions {
  isUpdating(): boolean
  prepare(): Promise<void>
  exit(code: number): void
  /** Upper bound for cleanup. Exit proceeds when it elapses, whatever is still in flight. */
  deadlineMs?: number
  onPrepareIncomplete?(reason: 'failed' | 'timed-out', error?: unknown): void
}

export interface QuitCoordinator {
  prepare(): Promise<void>
  handleBeforeQuit(event: BeforeQuitEvent): Promise<void>
}

const DEFAULT_DEADLINE_MS = 5_000

/**
 * Exit is unconditional; cleanup is best-effort within a deadline.
 * `prepare` therefore never rejects and never outlives `deadlineMs`, so every
 * exit path (Cmd+Q, SIGTERM, updater handoff) reaches `exit`.
 */
export function createQuitCoordinator(options: QuitCoordinatorOptions): QuitCoordinator {
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS
  let preparation: Promise<void> | null = null

  const prepare = (): Promise<void> => {
    preparation ??= new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        options.onPrepareIncomplete?.('timed-out')
        resolve()
      }, deadlineMs)
      options.prepare().then(
        () => { clearTimeout(timer); resolve() },
        (error) => {
          clearTimeout(timer)
          options.onPrepareIncomplete?.('failed', error)
          resolve()
        },
      )
    })
    return preparation
  }

  return {
    prepare,
    async handleBeforeQuit(event) {
      if (options.isUpdating()) return

      event.preventDefault()
      try {
        await prepare()
      } finally {
        options.exit(0)
      }
    },
  }
}
