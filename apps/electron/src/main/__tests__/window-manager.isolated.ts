// input: Electron BrowserWindow construction options from WindowManager
// output: Regression coverage for packaged-window paint stability
// pos: Isolated regression coverage for native packaged client window defaults

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'

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
  dialog: { showErrorBox: mock(() => {}) },
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

const { WindowManager } = await import('../window-manager')

describe('WindowManager', () => {
  beforeEach(() => {
    createdWindowOptions.length = 0
    createdWindows.length = 0
    loadError = undefined
  })

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

  it('does not turn cancelled navigation into fatal startup recovery', async () => {
    loadError = Object.assign(new Error('Navigation was cancelled'), { code: 'ERR_ABORTED', errno: -3 })
    const recovery = mock(() => {})
    const manager = new WindowManager(recovery)
    manager.createWindow({ workspaceId: '' })
    await Promise.resolve()
    expect(recovery).not.toHaveBeenCalled()
  })
})
