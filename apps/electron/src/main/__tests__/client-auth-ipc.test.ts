// input: Electron main/preload/renderer client-auth source files
// output: Regression coverage for cross-window client-auth state propagation
// pos: Static IPC contract guard for the desktop login gate

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const electronRoot = join(import.meta.dir, '..', '..')

function readElectronFile(path: string): string {
  return readFileSync(join(electronRoot, path), 'utf8')
}

describe('client auth IPC propagation', () => {
  it('broadcasts client auth state changes from main to every window', () => {
    const source = readElectronFile('main/index.ts')

    expect(source).toContain('client-auth:state-changed')
    expect(source).toContain('BrowserWindow.getAllWindows()')
    expect(source).toContain('broadcastClientAuthState()')
  })

  it('updates preload auth cache and exposes a renderer subscription', () => {
    const source = readElectronFile('preload/bootstrap.ts')

    expect(source).toContain('onClientAuthStateChanged')
    expect(source).toContain('signUpClient')
    expect(source).toContain("ipcRenderer.on('client-auth:state-changed'")
    expect(source).toContain('cachedClientAuthState = nextState')
  })

  it('keeps the login gate subscribed after the initial state load', () => {
    const source = readElectronFile('renderer/components/auth/ClientAuthGate.tsx')

    expect(source).toContain('onClientAuthStateChanged')
    expect(source).toContain('signUpClient')
    expect(source).toContain('setState(nextState)')
  })
})

describe('feedback IPC contract', () => {
  it('registers the main handler exposed by preload', () => {
    const mainSource = readElectronFile('main/index.ts')
    const preloadSource = readElectronFile('preload/bootstrap.ts')

    expect(preloadSource).toContain("ipcRenderer.invoke('feedback:submitIssue'")
    expect(mainSource).toContain("ipcMain.handle('feedback:submitIssue'")
  })
})
