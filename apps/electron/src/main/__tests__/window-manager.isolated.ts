// input: Electron BrowserWindow construction options from WindowManager
// output: Regression coverage for packaged-window paint stability
// pos: Isolated regression coverage for native packaged client window defaults

import { beforeEach, describe, expect, it, mock } from 'bun:test'

const createdWindowOptions: any[] = []

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
  BrowserWindow: class MockBrowserWindow {
    webContents = createMockWebContents()

    constructor(opts?: any) {
      createdWindowOptions.push(opts)
    }

    once = mock(() => {})
    on = mock(() => {})
    loadFile = mock(() => {})
    loadURL = mock(() => {})
    show = mock(() => {})
    isDestroyed = mock(() => false)
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
  })

  it('sets a native window background to avoid packaged paint flashes', () => {
    const manager = new WindowManager()

    manager.createWindow({ workspaceId: 'workspace-1' })

    expect(createdWindowOptions[0]?.backgroundColor).toBe('#fafafb')
  })

  it('resets renderer zoom for a stable first project layout', () => {
    const manager = new WindowManager()

    const win = manager.createWindow({ workspaceId: 'workspace-1' }) as any

    expect(win.webContents.setZoomFactor).toHaveBeenCalledWith(1)
  })
})
