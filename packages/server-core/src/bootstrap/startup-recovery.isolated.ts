// input: Isolated Host data and faults at the shared bootstrap/stop boundary
// output: Regression evidence for data preservation and bounded lifecycle cleanup
// pos: Shared desktop/headless startup acceptance
import { afterAll, expect, mock, test } from 'bun:test'
import * as os from 'node:os'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { connect, createServer } from 'node:net'
import { execFileSync } from 'node:child_process'

const root = mkdtempSync(join(os.tmpdir(), 'storyflow-startup-'))
const configDir = join(root, 'config')
mkdirSync(configDir)
process.env.CRAFT_CONFIG_DIR = configDir
mock.module('node:os', () => ({ ...os, homedir: () => root }))
mock.module('os', () => ({ ...os, homedir: () => root }))
const { bootstrapServer, releaseServerLock } = await import('./headless-start')
const base = {
  serverToken: 'startup-test-token-0123456789', rpcHost: '127.0.0.1', rpcPort: 0,
  bundledAssetsRoot: root,
  createSessionManager: () => ({}), createHandlerDeps: () => ({}),
  registerAllRpcHandlers() {}, initializeSessionManager: async () => {},
  setSessionEventSink() {}, initModelRefreshService: () => ({ startAll() {}, stopAll() {} }),
}
afterAll(() => { releaseServerLock(); rmSync(root, { recursive: true, force: true }) })

test('damaged Host configuration is preserved instead of initialized as an empty registry', async () => {
  const configPath = join(configDir, 'config.json')
  const original = '{"workspaces":[{"id":"important-project"}],"broken":'
  writeFileSync(configPath, original)
  let instance: Awaited<ReturnType<typeof bootstrapServer>> | undefined
  try {
    await expect((async () => { instance = await bootstrapServer(base) })()).rejects.toThrow()
    expect(readFileSync(configPath, 'utf8')).toBe(original)
  } finally {
    await instance?.stop()
    rmSync(configPath, { force: true })
  }
})

test('optional documentation failure does not prevent a usable Host', async () => {
  mkdirSync(join(root, '.craft-agent'), { recursive: true })
  const docs = join(root, '.craft-agent/docs')
  rmSync(docs, { recursive: true, force: true })
  writeFileSync(docs, 'preserve the blocking file')
  mkdirSync(join(root, 'resources/docs'), { recursive: true })
  writeFileSync(join(root, 'resources/docs/sources.md'), 'optional documentation')
  const instance = await bootstrapServer(base)
  try {
    expect(instance.port).toBeGreaterThan(0)
    expect(readFileSync(docs, 'utf8')).toBe('preserve the blocking file')
  } finally { await instance.stop() }
})

test('handler registration failure leaves no listening service or lease', async () => {
  const reservation = createServer()
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = (reservation.address() as import('node:net').AddressInfo).port
  await new Promise<void>(resolve => reservation.close(() => resolve()))
  await expect(bootstrapServer({ ...base, rpcPort: port, registerAllRpcHandlers() { throw new Error('handler failed') } })).rejects.toThrow('handler failed')
  const listening = await new Promise<boolean>(resolve => {
    const socket = connect(port, '127.0.0.1')
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
  })
  expect(listening).toBe(false)
  expect(existsSync(join(configDir, '.server.lease'))).toBe(false)
})

test('stop during initialization is bounded, shared, and retains ownership until writers finish', async () => {
  let finish!: () => void
  const initializing = new Promise<void>(resolve => { finish = resolve })
  let refreshStarted = false
  const instance = await bootstrapServer({ ...base, deferRuntimeInitialization: true, stopTimeoutMs: 30,
    initializeSessionManager: () => initializing,
    initModelRefreshService: () => ({ startAll() { refreshStarted = true } }),
  })
  const ready = instance.startRuntime()
  const stopping = instance.stop()
  expect(instance.stop()).toBe(stopping)
  await expect(stopping).rejects.toMatchObject({ code: 'STOP_TIMEOUT' })
  expect(existsSync(join(configDir, '.server.lease'))).toBe(true)
  finish()
  await ready
  expect(refreshStarted).toBe(false)
  // The test owns no real writers; a production host must exit after timeout.
  releaseServerLock()
})

test('an explicitly selected valid backup restores configuration while preserving damaged bytes', async () => {
  const original = '{damaged'
  const configPath = join(configDir, 'config.json')
  const name = 'config.json.bak-2026-01-01'
  writeFileSync(configPath, original)
  writeFileSync(join(configDir, name), JSON.stringify({ workspaces: [], activeWorkspaceId: null, customHistoricalField: 'keep-me' }))
  const instance = await bootstrapServer({ ...base, restoreConfigBackup: name })
  try {
    expect(JSON.parse(readFileSync(configPath, 'utf8')).customHistoricalField).toBe('keep-me')
    const { readdirSync } = await import('node:fs')
    const preserved = readdirSync(configDir).find(name => name.startsWith('config.json.damaged-'))!
    expect(readFileSync(join(configDir, preserved), 'utf8')).toBe(original)
  } finally { await instance.stop() }
})

test('shutdown rejects late session admission and drains accepted RPC work before releasing ownership', async () => {
  const { SessionManager, setSessionPlatform } = await import('../sessions')
  const { getFreeConversationWorkspace } = await import('@craft-agent/shared/workspaces')
  const { WsRpcClient } = await import('../transport/client')
  mkdirSync(getFreeConversationWorkspace().rootPath, { recursive: true })
  let entered!: () => void, resume!: () => void, cleanupStarted!: () => void
  const requestEntered = new Promise<void>(resolve => { entered = resolve })
  const continueRequest = new Promise<void>(resolve => { resume = resolve })
  const shuttingDown = new Promise<void>(resolve => { cleanupStarted = resolve })
  let lateAdmissionError: unknown
  const instance = await bootstrapServer({ ...base,
    applyPlatformToSubsystems: setSessionPlatform,
    createSessionManager: () => new SessionManager(),
    createHandlerDeps: ({ sessionManager }) => sessionManager,
    registerAllRpcHandlers(server, manager) {
      server.handle('test:late-session', async () => {
        entered()
        await continueRequest
        try { await manager.createSession(getFreeConversationWorkspace().id) }
        catch (error) { lateAdmissionError = error }
      })
    },
    cleanupSessionManager: async (manager, drained) => {
      const closing = manager.shutdown(drained)
      cleanupStarted()
      await closing
    },
  })
  const client = new WsRpcClient(`ws://127.0.0.1:${instance.port}`, { token: base.serverToken, autoReconnect: false })
  const request = client.invoke('test:late-session').catch(() => {})
  await requestEntered
  const stopping = instance.stop()
  await shuttingDown
  expect(existsSync(join(configDir, '.server.lease'))).toBe(true)
  resume()
  try {
    await stopping
    expect(lateAdmissionError).toBeInstanceOf(Error)
    expect((lateAdmissionError as Error).message).toContain('shutting down')
    expect(existsSync(join(configDir, '.server.lease'))).toBe(false)
  } finally { client.destroy(); await request }
})

test('embedded TLS uses the published endpoint and scoped certificate trust', async () => {
  const cert = join(root, 'cert.pem'), key = join(root, 'key.pem')
  const opensslConfig = join(root, 'openssl.cnf')
  writeFileSync(opensslConfig, '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-config', opensslConfig], { stdio: 'ignore' })
  const { loadServerTls, localServerEndpoint } = await import('./tls')
  const { WsRpcClient } = await import('../transport/client')
  // Exercise the npm ws implementation used by Electron, not Bun's ws shim.
  const { default: NodeWebSocket } = await import(join(dirname(require.resolve('ws/package.json')), 'index.js'))
  expect(() => loadServerTls(cert, undefined)).toThrow()
  expect(() => loadServerTls(cert, join(root, 'missing-key'))).toThrow()
  const tls = loadServerTls(cert, key)!
  expect(() => localServerEndpoint('192.0.2.1', 1, tls)).toThrow()
  const instance = await bootstrapServer({ ...base, tls, registerAllRpcHandlers(server) { server.handle('test:hello', () => 'encrypted') } })
  const endpoint = localServerEndpoint(instance.host, instance.port, tls)
  const client = new WsRpcClient(endpoint.url, { token: base.serverToken, autoReconnect: false,
    webSocketFactory: url => new NodeWebSocket(url, { ca: endpoint.ca, allowPartialTrustChain: true }) as unknown as WebSocket,
  })
  try {
    expect(endpoint.url.startsWith('wss://')).toBe(true)
    expect(await client.invoke('test:hello')).toBe('encrypted')
    const untrusted = new WsRpcClient(endpoint.url, { token: base.serverToken, autoReconnect: false, connectTimeout: 500,
      webSocketFactory: url => new NodeWebSocket(url) as unknown as WebSocket,
    })
    try { await expect(untrusted.invoke('test:hello')).rejects.toThrow() } finally { untrusted.destroy() }
  } finally { client.destroy(); await instance.stop() }
})

test('stop holds ownership until an accepted HTTP handler finishes even after its client disconnects', async () => {
  const { nodeHttpAdapter } = await import('../webui/node-adapter')
  let entered!: () => void, resume!: () => void
  const handling = new Promise<void>(resolve => { entered = resolve })
  const paused = new Promise<void>(resolve => { resume = resolve })
  const written = join(configDir, 'http-write')
  let ownedAtWrite = false
  const instance = await bootstrapServer({ ...base, httpHandler: nodeHttpAdapter(async () => {
    entered()
    await paused
    ownedAtWrite = existsSync(join(configDir, '.server.lease'))
    writeFileSync(written, 'accepted request completed')
    return new Response('ok')
  }) })
  const request = fetch(`http://127.0.0.1:${instance.port}`).catch(() => {})
  await handling
  let stopped = false
  const stopping = instance.stop().then(() => { stopped = true })
  try {
    await Bun.sleep(20)
    expect(stopped).toBe(false)
    expect(existsSync(join(configDir, '.server.lease'))).toBe(true)
  } finally { resume(); await stopping; await request }
  expect(ownedAtWrite).toBe(true)
  expect(readFileSync(written, 'utf8')).toBe('accepted request completed')
  expect(existsSync(join(configDir, '.server.lease'))).toBe(false)
})
