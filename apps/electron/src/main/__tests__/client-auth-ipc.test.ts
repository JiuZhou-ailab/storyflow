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

    expect(source).toContain('CLIENT_AUTH_IPC_CHANNELS.STATE_CHANGED')
    expect(source).toContain('BrowserWindow.getAllWindows()')
    expect(source).toContain('onAuthChange: async (change)')
    expect(source).toContain('broadcastClientAuthState(change.state)')
  })

  it('wires managed model-token refresh and revocation into live runtimes', () => {
    const source = readElectronFile('main/index.ts')

    expect(source).toContain('ensureManagedModelAccessToken: async (forceRefresh)')
    expect(source).toContain('authService.ensureModelAccessToken')
    expect(source).toContain('reloadConnectionCredentials(MANAGED_LLM_CONNECTION_SLUG)')
    expect(source).toContain('disposeConnectionRuntimes(MANAGED_LLM_CONNECTION_SLUG)')
    expect(source).toContain('managedModelAccessAvailable: !serverModeEnabled && managedModelAccessConfigured')
    expect(source).toContain('clientAuthService?.dispose()')
  })

  it('updates preload auth cache and exposes a renderer subscription', () => {
    const source = readElectronFile('preload/bootstrap.ts')

    expect(source).toContain('onClientAuthStateChanged')
    expect(source).toContain('signUpClient')
    expect(source).toContain('ipcRenderer.on(CLIENT_AUTH_IPC_CHANNELS.STATE_CHANGED')
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
