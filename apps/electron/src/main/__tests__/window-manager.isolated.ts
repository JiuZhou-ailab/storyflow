// input: Electron BrowserWindow construction options from WindowManager
// output: Regression coverage for packaged-window defaults and phase-aware failure recovery
// pos: Exercises native window behavior at the Electron boundary

import { afterAll, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Model Electron's packaged resources boundary with a real temporary icon.
const resources = mkdtempSync(join(tmpdir(), 'storyflow-window-icon-'))
const resourceDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
Object.defineProperty(process, 'resourcesPath', { value: resources, configurable: true })
writeFileSync(join(resources, 'icon.icns'), 'icon fixture')
afterAll(() => {
  if (resourceDescriptor) Object.defineProperty(process, 'resourcesPath', resourceDescriptor)
  else Reflect.deleteProperty(process, 'resourcesPath')
  rmSync(resources, { recursive: true, force: true })
})

const createdWindowOptions: any[] = []
const createdWindows: any[] = []
let loadError: Error | undefined

function createMockWebContents() {
  const listeners: Record<string, Function[]> = {}
  return {
    id: createdWindowOptions.length + 1,
    isDestroyed: mock(() => false),
    mainFrame: true,
    reload: mock(() => {}),
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of listeners[event] ?? []) listener(...args)
    },
    on: mock((event: string, cb: Function) => {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(cb)
    }),
    setWindowOpenHandler: mock(() => {}),
    setZoomFactor: mock(() => {}),
    send: mock(() => {}),
  }
}

mock.module('electron', () => ({
  app: {
    isPackaged: true,
  },
  dialog: { showErrorBox: mock(() => {}), showMessageBox: mock(async () => ({ response: 0 })) },
  screen: {
    getPrimaryDisplay: () => ({
      workAreaSize: { width: 1280, height: 720 },
    }),
  },
  BrowserWindow: class MockBrowserWindow {
    private listeners: Record<string, Function[]> = {}
    webContents = createMockWebContents()

    constructor(opts?: any) {
      createdWindowOptions.push(opts)
      createdWindows.push(this)
    }

    once = mock(() => {})
    on = mock((event: string, cb: Function) => {
      if (!this.listeners[event]) this.listeners[event] = []
      this.listeners[event].push(cb)
    })
    loadFile = mock(async () => { if (loadError) throw loadError })
    loadURL = mock(async () => { if (loadError) throw loadError })
    show = mock(() => {})
    isDestroyed = mock(() => false)
    destroy = mock(() => {})
    getBounds = mock(() => ({ x: 10, y: 20, width: 1200, height: 800 }))
  },
  Menu: {
    buildFromTemplate: mock(() => ({ popup: mock(() => {}) })),
  },
  nativeTheme: {
    shouldUseDarkColors: false,
    on: mock(() => {}),
    off: mock(() => {}),
  },
  shell: {
    openExternal: mock(() => {}),
  },
}))

mock.module('../logger', () => {
  const stubLog = {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
  }
  return {
    mainLog: stubLog,
    sessionLog: stubLog,
    handlerLog: stubLog,
    windowLog: stubLog,
    searchLog: stubLog,
    isDebugMode: false,
    getLogFilePath: () => '/tmp/main.log',
    getMessagingGatewayLogFilePath: () => '/tmp/messaging-gateway.log',
    messagingGatewayLog: stubLog,
    default: stubLog,
  }
})

let windowsMaterialEnabled = false
let windowsRelease = '10.0.22631'
mock.module('@craft-agent/shared/config/storage', () => ({
  getWindowsBackgroundMaterialEnabled: () => windowsMaterialEnabled,
}))
mock.module('os', () => ({ release: () => windowsRelease, tmpdir }))

const { WindowManager } = await import('../window-manager')
const { dialog } = await import('electron')

describe('WindowManager', () => {
  beforeEach(() => {
    createdWindowOptions.length = 0
    createdWindows.length = 0
    loadError = undefined
    ;(dialog.showMessageBox as any).mockClear()
  })

  for (const [enabled, version, expected] of [
    [false, '10.0.22631', undefined],
    [false, '10.0.19045', undefined],
    [true, '10.0.22000', 'mica'],
    [true, '10.0.17763', 'acrylic'],
    [true, '10.0.17762', undefined],
    [true, 'invalid', undefined],
  ] as const) {
    it(`Windows material enabled=${enabled} version=${version}: ${expected}`, () => {
      const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      windowsMaterialEnabled = enabled
      windowsRelease = version
      try {
        new WindowManager().createWindow({ workspaceId: '' })
        expect(createdWindowOptions[0].backgroundMaterial).toBe(expected)
        expect(createdWindowOptions[0].transparent).not.toBe(true)
        expect(createdWindowOptions[0].backgroundColor).toBe('#fafafb')
      } finally {
        Object.defineProperty(process, 'platform', platform)
        windowsMaterialEnabled = false
      }
    })
  }

  it('sets a native window background to avoid packaged paint flashes', () => {
    const manager = new WindowManager()

    manager.createWindow({ workspaceId: 'workspace-1' })

    expect(createdWindowOptions[0]?.backgroundColor).toBe('#fafafb')
  })

  it.skipIf(process.platform !== 'darwin')('reuses the packaged bundle icon for macOS windows', () => {
    new WindowManager().createWindow({ workspaceId: 'workspace-1' })
    expect(createdWindowOptions[0]?.icon).toBe(join(resources, 'icon.icns'))
  })

  it('keeps native renderer zoom stable for smooth window resizing', () => {
    const manager = new WindowManager()

    const win = manager.createWindow({ workspaceId: 'workspace-1' }) as any

    expect(win.webContents.setZoomFactor).toHaveBeenCalledWith(1)
  })

  it('fits the ordinary startup window inside the primary display work area', () => {
    const manager = new WindowManager()

    manager.createWindow({ workspaceId: '' })

    expect(createdWindowOptions[0]?.width).toBeLessThanOrEqual(1280 - 64)
    expect(createdWindowOptions[0]?.height).toBeLessThanOrEqual(720 - 64)
    expect(createdWindowOptions[0]?.width / createdWindowOptions[0]?.height).toBeCloseTo(1400 / 900, 1)
  })

  it('does not attach a native resize handler for renderer zoom', () => {
    const manager = new WindowManager()

    const win = manager.createWindow({ workspaceId: 'workspace-1' }) as any

    const resizeHandlers = win.on.mock.calls.filter((call: unknown[]) => call[0] === 'resize')
    expect(resizeHandlers).toHaveLength(0)
  })

  it('captures the closing window before it is destroyed', () => {
    const manager = new WindowManager()
    const snapshots: unknown[] = []
    manager.setBeforeWindowDestroyed((closingWindow, remainingWindows) => {
      snapshots.push({ closingWindow, remainingWindows })
    })

    const win = manager.createWindow({ workspaceId: 'workspace-1' }) as any
    win.webContents.getURL = mock(() => 'file:///renderer/index.html?sessionId=session-1')
    manager.forceCloseWindow(win.webContents.id)

    expect(snapshots).toEqual([{
      closingWindow: {
        type: 'main',
        workspaceId: 'workspace-1',
        bounds: { x: 10, y: 20, width: 1200, height: 800 },
        url: 'file:///renderer/index.html?sessionId=session-1',
      },
      remainingWindows: [],
    }])
    expect(createdWindows[0].destroy).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['preload-error', ['/preload', new Error('broken preload')]],
    ['did-fail-load', [-2, 'failed', 'file:///renderer/index.html', true]],
  ] as const)('keeps a window first %s failure on startup recovery even when the Host is ready', (event, args) => {
    const recovery = mock(() => {})
    const win = new WindowManager(recovery, () => true).createWindow({ workspaceId: '' }) as any
    win.webContents.emit(event, {}, ...args)
    expect(recovery).toHaveBeenCalledTimes(1)
    expect(win.webContents.reload).not.toHaveBeenCalled()
  })

  it('waits for every initial window to finish its first load', async () => {
    const manager = new WindowManager()
    const first = manager.createWindow({ workspaceId: 'first' }) as any
    const second = manager.createWindow({ workspaceId: 'second' }) as any
    let ready = false
    const loading = manager.waitForInitialLoads().then(() => { ready = true })
    first.webContents.emit('did-finish-load')
    await Promise.resolve()
    expect(ready).toBe(false)
    second.webContents.emit('did-finish-load')
    await loading
    expect(ready).toBe(true)
  })

  it('rejects first-load readiness after a preload error even if did-finish-load follows', async () => {
    const manager = new WindowManager(mock(() => {}))
    const win = manager.createWindow({ workspaceId: '' }) as any
    const loading = manager.waitForInitialLoads()
    win.webContents.emit('preload-error', {}, '/preload', new Error('broken preload'))
    win.webContents.emit('did-finish-load')
    await expect(loading).rejects.toMatchObject({ code: 'PRELOAD' })
  })

  it('keeps failures in startup recovery after first paint until bootstrap completes', () => {
    const recovery = mock(() => {})
    const win = new WindowManager(recovery, () => false).createWindow({ workspaceId: '' }) as any
    win.webContents.emit('did-finish-load')
    win.webContents.emit('render-process-gone', {})
    expect(recovery).toHaveBeenCalledTimes(1)
    expect(win.webContents.reload).not.toHaveBeenCalled()
  })

  it('reloads only the failed window after startup without invoking recovery', async () => {
    let started = false
    const recovery = mock(() => {})
    const manager = new WindowManager(recovery, () => started)
    const failedWindow = manager.createWindow({ workspaceId: 'workspace-1' }) as any
    const otherWindow = manager.createWindow({ workspaceId: 'workspace-2' }) as any
    failedWindow.webContents.emit('did-finish-load')
    otherWindow.webContents.emit('did-finish-load')
    started = true

    failedWindow.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    await Bun.sleep(1100)

    expect(failedWindow.webContents.reload).toHaveBeenCalledTimes(1)
    expect(otherWindow.webContents.reload).not.toHaveBeenCalled()
    expect(recovery).not.toHaveBeenCalled()
  })

  it('stops repeated runtime failures at three reloads and shows an error on that window', async () => {
    const recovery = mock(() => {})
    const manager = new WindowManager(recovery, () => true)
    const win = manager.createWindow({ workspaceId: 'workspace-1' }) as any
    win.webContents.emit('did-finish-load')
    for (let attempt = 0; attempt < 3; attempt++) {
      win.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
      await Bun.sleep(1100)
      win.webContents.emit('did-finish-load')
    }
    win.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    win.webContents.emit('preload-error', {}, '/preload', new Error('broken preload'))
    await Bun.sleep(1100)

    expect(win.webContents.reload).toHaveBeenCalledTimes(3)
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
    expect((dialog.showMessageBox as any).mock.calls[0][0]).toBe(win)
    expect(recovery).not.toHaveBeenCalled()
    expect(win.destroy).not.toHaveBeenCalled()
  }, 10_000)

  const failures = [
    ['render-process-gone', [{ reason: 'crashed' }], 'RENDERER_CRASH'],
    ['preload-error', ['/preload', new Error('broken preload')], 'PRELOAD'],
    ['did-fail-load', [-2, 'failed', 'file:///renderer/index.html', true], 'RENDERER_LOAD'],
  ] as const

  it.each(failures)('preserves startup recovery for %s', (event, args, code) => {
    const recovery = mock((_error: Error) => {})
    const win = new WindowManager(recovery, () => false).createWindow({ workspaceId: '' }) as any
    win.webContents.emit(event, {}, ...args)
    win.webContents.emit(event, {}, ...args)

    expect(recovery).toHaveBeenCalledTimes(1)
    expect(recovery.mock.calls[0]?.[0]).toMatchObject({ code })
    expect(win.webContents.reload).not.toHaveBeenCalled()
  })

  it.each(failures)('coalesces runtime %s failures into one window reload', async (event, args) => {
    const recovery = mock(() => {})
    const win = new WindowManager(recovery, () => true).createWindow({ workspaceId: '' }) as any
    win.webContents.emit('did-finish-load')
    win.webContents.emit(event, {}, ...args)
    win.webContents.emit(event, {}, ...args)
    await Bun.sleep(1100)

    expect(win.webContents.reload).toHaveBeenCalledTimes(1)
    expect(recovery).not.toHaveBeenCalled()
  })

  it('ignores aborted and subframe loads at runtime', async () => {
    const win = new WindowManager(undefined, () => true).createWindow({ workspaceId: '' }) as any
    win.webContents.emit('did-finish-load')
    win.webContents.emit('did-fail-load', {}, -3, 'aborted', '', true)
    win.webContents.emit('did-fail-load', {}, -2, 'failed', '', false)
    await Bun.sleep(1100)
    expect(win.webContents.reload).not.toHaveBeenCalled()
  })

  it('cancels pending runtime reloads when the application starts quitting', async () => {
    const manager = new WindowManager(undefined, () => true)
    const win = manager.createWindow({ workspaceId: '' }) as any
    win.webContents.emit('did-finish-load')
    win.webContents.emit('render-process-gone', {})
    manager.setAppQuitting(true)
    await Bun.sleep(1100)
    expect(win.webContents.reload).not.toHaveBeenCalled()
  })

  it('recovers a first-load rejection without a did-fail-load event', async () => {
    loadError = new Error('load failed')
    const recovery = mock(() => {})
    const win = new WindowManager(recovery, () => true).createWindow({ workspaceId: '' }) as any
    await Promise.resolve()
    expect(win.webContents.reload).not.toHaveBeenCalled()
    expect(recovery).toHaveBeenCalledTimes(1)
  })

  it('allows later recovery after old failures age out of the window budget', async () => {
    const now = spyOn(Date, 'now').mockReturnValue(0)
    try {
      const win = new WindowManager(undefined, () => true).createWindow({ workspaceId: '' }) as any
      win.webContents.emit('did-finish-load')
      for (let attempt = 0; attempt < 3; attempt++) {
        win.webContents.emit('render-process-gone', {})
        await Bun.sleep(1100)
      }
      now.mockReturnValue(60_001)
      win.webContents.emit('render-process-gone', {})
      await Bun.sleep(1100)
      expect(win.webContents.reload).toHaveBeenCalledTimes(4)
      expect(dialog.showMessageBox).not.toHaveBeenCalled()
    } finally {
      now.mockRestore()
    }
  }, 10_000)

  it('logs an unresponsive renderer and reloads only after the user chooses reload', async () => {
    const pending: Array<() => void> = []
    const win = new WindowManager(undefined, () => true).createWindow({ workspaceId: '' }) as any
    win.webContents.emit('did-finish-load')
    ;(dialog.showMessageBox as any).mockImplementation(async () => ({ response: 1 }))
    const timers = spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, delay?: number) => {
      if (delay === 10_000) pending.push(fn)
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout)
    try {
      win.webContents.emit('unresponsive')
      expect(dialog.showMessageBox).not.toHaveBeenCalled()

      pending.splice(0).forEach(fn => fn())
      await Bun.sleep(0)
      expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
      expect(win.webContents.reload).toHaveBeenCalledTimes(1)

      ;(dialog.showMessageBox as any).mockImplementation(async () => ({ response: 0 }))
      win.webContents.emit('unresponsive')
      pending.splice(0).forEach(fn => fn())
      await Bun.sleep(0)
      expect(win.webContents.reload).toHaveBeenCalledTimes(1)
    } finally {
      timers.mockRestore()
      ;(dialog.showMessageBox as any).mockImplementation(async () => ({ response: 0 }))
    }
  })

  it('drops the unresponsive prompt when the renderer recovers first', () => {
    const win = new WindowManager(undefined, () => true).createWindow({ workspaceId: '' }) as any
    win.webContents.emit('did-finish-load')
    const timers = spyOn(globalThis, 'setTimeout').mockImplementation((() => 7) as unknown as typeof setTimeout)
    const clear = spyOn(globalThis, 'clearTimeout')
    try {
      win.webContents.emit('unresponsive')
      win.webContents.emit('responsive')
      expect(clear).toHaveBeenCalledWith(7)
      expect(dialog.showMessageBox).not.toHaveBeenCalled()
    } finally {
      timers.mockRestore()
      clear.mockRestore()
    }
  })

  it('does not turn cancelled navigation into fatal startup recovery', async () => {
    loadError = Object.assign(new Error('Navigation was cancelled'), { code: 'ERR_ABORTED', errno: -3 })
    const recovery = mock(() => {})
    const manager = new WindowManager(recovery)
    manager.createWindow({ workspaceId: '' })
    await Promise.resolve()
    expect(recovery).not.toHaveBeenCalled()
  })
})
