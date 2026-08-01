// input: Electron BrowserWindow construction options from WindowManager
// output: Regression coverage for packaged-window paint stability
// pos: Isolated regression coverage for native packaged client window defaults

import { beforeEach, describe, expect, it, mock } from 'bun:test'

const createdWindowOptions: any[] = []
const createdWindows: any[] = []

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
    loadFile = mock(() => {})
    loadURL = mock(() => {})
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
    agentLog: stubLog,
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
  })

  it('sets a native window background to avoid packaged paint flashes', () => {
    const manager = new WindowManager()

    manager.createWindow({ workspaceId: 'workspace-1' })

    expect(createdWindowOptions[0]?.backgroundColor).toBe('#fafafb')
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
})
