// input: Main-process before-quit wiring and per-window document leave checks
// output: Regression coverage for hung renderers and a second quit after cancel
// pos: Exercises the document-exit gate without booting the desktop Host

import { expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const index = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
const wiring = index.slice(index.indexOf('const DOCUMENT_LEAVE_TIMEOUT_MS'), index.indexOf("process.on('uncaughtException'"))

function runQuit(options: {
  leave: () => Promise<unknown>
  isUpdating?: boolean
}) {
  const events: string[] = []
  const context = {
    DOCUMENT_LEAVE_TIMEOUT_MS: undefined as number | undefined,
    setTimeout,
    clearTimeout,
    BrowserWindow: { getAllWindows: () => [{ webContents: {
      isDestroyed: () => false,
      isLoading: () => false,
      executeJavaScript: options.leave,
    } }] },
    mainLog: { warn: () => {}, error: () => {}, info: () => {} },
    setUpdateInstallPreparation: () => {},
    UpdateInstallCancelledError: class UpdateInstallCancelledError extends Error {},
    isUpdating: () => options.isUpdating ?? false,
    quitCoordinator: { handleBeforeQuit: async () => { events.push('exit') } },
    app: { on: (event: string, handler: (...args: never[]) => Promise<void>) => {
      if (event === 'before-quit') context.beforeQuit = handler as typeof context.beforeQuit
    } },
    beforeQuit: undefined as ((event: { preventDefault(): void }) => Promise<void>) | undefined,
  }
  runInNewContext(new Bun.Transpiler({ loader: 'ts' }).transformSync(wiring), context)
  return {
    events,
    beforeQuit: async () => {
      let prevented = false
      await context.beforeQuit!({ preventDefault() { prevented = true } })
      return prevented
    },
  }
}

it('does not block quit when a renderer never answers the leave check', async () => {
  const quit = runQuit({ leave: () => new Promise(() => {}) })
  const started = Date.now()

  expect(await quit.beforeQuit()).toBe(true)

  expect(Date.now() - started).toBeLessThan(4_000)
  expect(quit.events).toEqual(['exit'])
}, 5_000)

it('checks the document again after the user cancels the first quit', async () => {
  let approved = false
  let checks = 0
  const quit = runQuit({ leave: async () => { checks += 1; return approved } })

  expect(await quit.beforeQuit()).toBe(true)
  expect(quit.events).toEqual([])

  approved = true
  expect(await quit.beforeQuit()).toBe(true)
  expect(checks).toBe(2)
  expect(quit.events).toEqual(['exit'])
})

it('logs a GPU child process exit and ignores other child processes', () => {
  const logged: string[] = []
  const handlers: Record<string, (event: unknown, details: { type: string, reason: string }) => void> = {}
  runInNewContext(new Bun.Transpiler({ loader: 'ts' }).transformSync(wiring), {
    DOCUMENT_LEAVE_TIMEOUT_MS: 3_000,
    BrowserWindow: { getAllWindows: () => [] },
    mainLog: { warn: () => {}, info: () => {}, error: (message: string) => { logged.push(message) } },
    setUpdateInstallPreparation: () => {},
    UpdateInstallCancelledError: class UpdateInstallCancelledError extends Error {},
    isUpdating: () => false,
    quitCoordinator: { handleBeforeQuit: async () => {} },
    app: { on: (event: string, handler: (event: unknown, details: { type: string, reason: string }) => void) => {
      handlers[event] = handler
    } },
  })

  handlers['child-process-gone']!({}, { type: 'Utility', reason: 'crashed' })
  handlers['child-process-gone']!({}, { type: 'GPU', reason: 'killed' })

  expect(logged).toEqual(['[process] GPU process gone (killed)'])
})
