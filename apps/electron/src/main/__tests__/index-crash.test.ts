// input: Main entrypoint process failure handlers and startup recovery wiring
// output: Startup/runtime failure isolation regression coverage
// pos: Exercises entrypoint handlers without booting the desktop Host

import { expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')

it.each([false, true])('routes process failures with runtime started = %s', (started) => {
  const handlers: Record<string, (...args: unknown[]) => void> = {}
  const recoverStartup = mock(() => {})
  const error = new Error('runtime failure')
  const mainLog = { error: mock(() => {}) }
  // Execute the actual process event wiring against the process boundary.
  runInNewContext(source.slice(source.indexOf("process.on('uncaughtException'")), {
    process: { on: (name: string, handler: (...args: unknown[]) => void) => { handlers[name] = handler } },
    mainStartupSucceeded: true, mainRuntimeStarted: started, mainLog, recoverStartup, recordStartupFailure: mock(() => {}),
  })

  handlers.uncaughtException!(error)
  handlers.unhandledRejection!(error, Promise.resolve())

  expect(mainLog.error).toHaveBeenCalledWith('Uncaught exception:', error)
  if (started) expect(recoverStartup).not.toHaveBeenCalled()
  else {
    expect(recoverStartup).toHaveBeenCalledWith(error, 'uncaught-exception')
    expect(recoverStartup).toHaveBeenCalledWith(error, 'unhandled-startup-rejection')
  }
})

it.each([false, true])('limits recovery teardown to startup with runtime started = %s', async (started) => {
  const recoverySource = source.slice(source.indexOf('async function recoverStartup('), source.indexOf('app.whenReady().then'))
  const app = { exit: mock(() => {}) }
  const quitCoordinator = { prepare: mock(async () => {}) }
  const showStartupRecovery = mock(async () => ({ restart: false }))
  const context = {
    mainStartupSucceeded: started, mainRuntimeStarted: started, recovering: false, mainStopping: false, fatalStartup: false,
    mainStartupIsHeadless: false, app, quitCoordinator, showStartupRecovery,
    recordStartupFailure: mock(() => {}),
  }
  await runInNewContext(new Bun.Transpiler({ loader: 'ts' }).transformSync(recoverySource)
    + '\nrecoverStartup(new Error("late failure"), "window")', context)

  if (started) {
    expect(app.exit).not.toHaveBeenCalled()
    expect(quitCoordinator.prepare).not.toHaveBeenCalled()
    expect(showStartupRecovery).not.toHaveBeenCalled()
    expect(context.mainStartupSucceeded).toBe(true)
  } else {
    expect(app.exit).toHaveBeenCalledWith(1)
    expect(quitCoordinator.prepare).toHaveBeenCalledTimes(1)
    expect(showStartupRecovery).toHaveBeenCalledTimes(1)
  }
})

it.each(['windows', 'deep-link', 'none'])('enters runtime only after a successful startup tail: %s', async (failureAt) => {
  const recoverySource = source.slice(source.indexOf('async function recoverStartup('), source.indexOf('app.whenReady().then'))
  const tail = source.slice(source.indexOf('    // Create initial windows (restores'), source.indexOf('  // macOS: Re-create window'))
  const failure = new Error(failureAt)
  const app = { exit: mock(() => {}) }
  const showStartupRecovery = mock(async () => ({ restart: false }))
  const context = {
    mainStartupSucceeded: false, mainRuntimeStarted: false, mainStopping: false, recovering: false,
    fatalStartup: false, mainStartupIsHeadless: false, isHeadless: false, isClientOnly: true,
    isDebugMode: false, scheduleDeferredRuntime: undefined, moduleSink: null, moduleClientResolver: null,
    pendingDeepLink: 'craftagents://allSessions', windowManager: {},
    parseDeepLink: () => ({ view: 'allSessions' }),
    shouldCreateWindowsAfterStartup: () => true,
    createInitialWindows: async (target: { view: string }) => {
      expect(target).toEqual({ view: 'allSessions' })
      expect(context.mainRuntimeStarted).toBe(false)
      if (failureAt === 'windows') throw failure
    },
    handleDeepLink: async () => { expect(context.mainRuntimeStarted).toBe(false); if (failureAt === 'deep-link') throw failure },
    mainLog: { info() {}, error() {}, warn() {} }, getMessagingGatewayLogFilePath: () => '',
    app, showStartupRecovery, quitCoordinator: { prepare: async () => {} }, recordStartupFailure: mock(() => {}),
  }
  await runInNewContext(new Bun.Transpiler({ loader: 'ts' }).transformSync(
    `${recoverySource}\nasync function exerciseStartup() { try {\n${tail}\n}\nexerciseStartup()`,
  ), context)
  if (failureAt === 'none') {
    expect(showStartupRecovery).not.toHaveBeenCalled()
    expect(app.exit).not.toHaveBeenCalled()
    expect(context.mainRuntimeStarted).toBe(true)
    return
  }
  expect(showStartupRecovery).toHaveBeenCalledTimes(1)
  expect(app.exit).toHaveBeenCalledWith(1)
  expect(context.mainStartupSucceeded).toBe(false)
  expect(context.mainRuntimeStarted).toBe(false)
})

it.each([
  { name: 'ordinary startup', savedIds: [], target: null, expected: [['', undefined]], targetId: undefined },
  { name: 'ordinary restore', savedIds: ['a', 'b'], target: null, expected: [['a', undefined], ['b', undefined]], targetId: undefined },
  { name: 'explicit target', savedIds: ['a', 'b'], target: { workspaceId: 'a' }, expected: [['a', 'external'], ['b', undefined]], targetId: 'a' },
  { name: 'implicit target', savedIds: ['a', 'b'], target: {}, expected: [['a', undefined], ['b', 'external']], targetId: 'b' },
  { name: 'new window link', savedIds: ['a', 'b'], target: { workspaceId: 'a', windowMode: 'full' }, expected: [['a', undefined], ['b', undefined]], targetId: undefined },
  { name: 'unrestored target', savedIds: ['a', 'b'], target: { workspaceId: 'c' }, expected: [['a', undefined], ['b', undefined]], targetId: undefined },
  { name: 'target without saved windows', savedIds: [], target: { workspaceId: 'a' }, expected: [['a', 'external']], targetId: 'a' },
])('scopes startup source and waits for window loads during $name', async ({ savedIds, target, expected, targetId }) => {
  let loaded!: () => void
  const ready = new Promise<void>(resolve => { loaded = resolve })
  const creationSource = source.slice(source.indexOf('async function createInitialWindows('), source.indexOf('async function recoverStartup('))
  const createWindow = mock(({ workspaceId }: { workspaceId: string; startupSource?: string }) => ({ workspaceId, center() {}, setBounds() {} }))
  const context = {
    target,
    windowManager: { createWindow, waitForInitialLoads: () => ready },
    loadWindowState: () => ({ windows: savedIds.map(workspaceId => ({ workspaceId, bounds: {} })), lastFocusedWorkspaceId: 'b' }),
    getWorkspaces: () => [], shouldRestoreWorkspaceWindowsOnOrdinaryStartup: () => true,
    isRestorableWindowWorkspace: () => true, resolveStartupWindowWorkspaceId: () => '',
    screen: { getAllDisplays: () => [] }, mainLog: { info() {} },
  }
  let completed = false
  const creation = runInNewContext(new Bun.Transpiler({ loader: 'ts' }).transformSync(creationSource)
    + '\ncreateInitialWindows(target)', context) as Promise<{ workspaceId: string } | undefined>
  void creation.then(() => { completed = true })
  await Promise.resolve()
  await Promise.resolve()
  expect(completed).toBe(false)
  const sources: ReadonlyArray<readonly (string | undefined)[]> = createWindow.mock.calls.map(
    ([options]) => [options.workspaceId, options.startupSource],
  )
  expect(sources).toEqual(expected)
  loaded()
  expect((await creation)?.workspaceId).toBe(targetId)
  expect(completed).toBe(true)
})
