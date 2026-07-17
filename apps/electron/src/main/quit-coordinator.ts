// input: Electron quit state plus application cleanup and exit callbacks
// output: Idempotent quit preparation and updater-safe before-quit handling
// pos: Owns the boundary between Storyflow cleanup and Electron's native quit flow

interface BeforeQuitEvent {
  preventDefault(): void
}

interface QuitCoordinatorOptions {
  isUpdating(): boolean
  prepare(): Promise<void>
  exit(code: number): void
}

export interface QuitCoordinator {
  prepare(): Promise<void>
  handleBeforeQuit(event: BeforeQuitEvent): Promise<void>
}

export function createQuitCoordinator(options: QuitCoordinatorOptions): QuitCoordinator {
  let preparation: Promise<void> | null = null

  const prepare = (): Promise<void> => {
    preparation ??= options.prepare()
    return preparation
  }

  return {
    prepare,
    async handleBeforeQuit(event) {
      if (options.isUpdating()) return

      event.preventDefault()
      await prepare()
      options.exit(0)
    },
  }
}
