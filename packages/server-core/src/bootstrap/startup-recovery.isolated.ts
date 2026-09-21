// input: Isolated Host data and faults at the shared bootstrap/stop boundary
// output: Regression evidence for data preservation and bounded lifecycle cleanup
// pos: Shared desktop/headless startup acceptance
import { afterAll, expect, mock, test } from 'bun:test'
import * as os from 'node:os'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { connect, createServer } from 'node:net'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

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
    const replacement = createServer()
    await new Promise<void>((resolve, reject) => {
      replacement.once('error', reject)
      replacement.listen(instance.port, '127.0.0.1', resolve)
    })
    await new Promise<void>(resolve => replacement.close(() => resolve()))
  } finally { client.destroy(); await request }
})

test('embedded TLS uses the published endpoint and scoped certificate trust', async () => {
  const cert = join(root, 'cert.pem'), key = join(root, 'key.pem')
  const opensslConfig = join(root, 'openssl.cnf')
  writeFileSync(opensslConfig, '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-config', opensslConfig], { stdio: 'ignore' })
  const { loadServerTls, localServerEndpoint } = await import('./tls')
  expect(() => loadServerTls(cert, undefined)).toThrow()
  expect(() => loadServerTls(cert, join(root, 'missing-key'))).toThrow()
  const tls = loadServerTls(cert, key)!
  expect(() => localServerEndpoint('192.0.2.1', 1, tls)).toThrow()
  const instance = await bootstrapServer({ ...base, tls, registerAllRpcHandlers(server) { server.handle('test:hello', () => 'encrypted') } })
  const endpoint = localServerEndpoint(instance.host, instance.port, tls)
  try {
    expect(endpoint.url.startsWith('wss://')).toBe(true)
    // Electron uses Node TLS. Running npm ws inside Bun still uses Bun's HTTP
    // client, whose 1.3.14 TLS upgrade behavior differs from the shipped client.
    const clientModule = join(root, 'client.mjs')
    const built = await Bun.build({ entrypoints: [join(import.meta.dir, '../transport/client.ts')], target: 'node' })
    expect(built.success).toBe(true)
    await Bun.write(clientModule, built.outputs[0]!)
    const proc = Bun.spawn(['node', '--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import { WsRpcClient } from ${JSON.stringify(pathToFileURL(clientModule).href)};
      import NodeWebSocket from ${JSON.stringify(pathToFileURL(join(dirname(require.resolve('ws/package.json')), 'index.js')).href)};
      const endpoint = ${JSON.stringify(endpoint)};
      const client = new WsRpcClient(endpoint.url, { token: ${JSON.stringify(base.serverToken)}, autoReconnect: false,
        webSocketFactory: url => new NodeWebSocket(url, { ca: endpoint.ca, allowPartialTrustChain: true }) });
      try { assert.equal(await client.invoke('test:hello'), 'encrypted'); } finally { client.destroy(); }
      const untrusted = new WsRpcClient(endpoint.url, { token: ${JSON.stringify(base.serverToken)}, autoReconnect: false, connectTimeout: 500,
        webSocketFactory: url => new NodeWebSocket(url) });
      try { await assert.rejects(untrusted.invoke('test:hello')); } finally { untrusted.destroy(); }
    `], { stdout: 'pipe', stderr: 'pipe' })
    // Leave room for cold Node startup on Windows; keep the child deadline
    // below the test budget so cleanup completes before the runner times out.
    const deadline = setTimeout(() => proc.kill(), 15_000)
    try {
      const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
      expect({ code, stderr }).toEqual({ code: 0, stderr: '' })
    } finally {
      clearTimeout(deadline)
      if (proc.exitCode === null) { proc.kill(); await proc.exited }
    }
  } finally { await instance.stop() }
}, 30_000)

test('shutdown snapshots drained messages without reviving deletes or losing healthy writes behind a missing transcript', async () => {
  const { SessionManager, createManagedSession } = await import('../sessions/SessionManager')
  const { DEFAULT_TOKEN_USAGE } = await import('../sessions/managed-session')
  const { writeSessionJsonl, getSessionFilePath, loadSession } = await import('@craft-agent/shared/sessions')
  // The persistence queue is process-wide: keep Host shutdown tests isolated
  // from unrelated suites' intentionally failed or abandoned writes.
  for (const missing of [false, true]) {
    const project = join(root, `shutdown-snapshot-${missing}`)
    mkdirSync(project)
    const workspace = { id: 'snapshot-project', slug: 'snapshot-project', name: 'Snapshot', rootPath: project, createdAt: Date.now() }
    const manager = new SessionManager((_id, managed) => managed.workspace)
    const seed = (id: string) => {
      const path = getSessionFilePath(project, id)
      mkdirSync(dirname(path), { recursive: true })
      writeSessionJsonl(path, { id, workspaceRootPath: project, createdAt: Date.now(), lastUsedAt: Date.now(), tokenUsage: DEFAULT_TOKEN_USAGE,
        messages: [{ id: 'before', type: 'user', content: 'before', timestamp: Date.now() }],
      }, project)
      const managed = createManagedSession({ id, createdAt: Date.now() }, workspace)
      ;(manager as any).sessions.set(id, managed)
      return managed
    }
    const cold = seed('cold')
    const external = loadSession(project, 'cold')!
    external.name = 'External rename before watcher notification'
    writeSessionJsonl(getSessionFilePath(project, 'cold'), external, project)
    const metadata = seed('metadata')
    if (missing) rmSync(getSessionFilePath(project, 'metadata'))
    const active = seed('active')
    const deleting = seed('deleting')
    deleting.runtimeState = 'deleting'
    deleting.runtimeEpoch = 7
    await manager.getSession(active.id)
    active.agent = { async disposeForRestart() {
      active.messages.push({ id: 'tail', role: 'assistant', content: 'final result', timestamp: Date.now() })
      ;(manager as any).persistSession(active)
      metadata.name = 'Accepted metadata change'
      ;(manager as any).persistSession(metadata)
    } } as any
    try {
      if (missing) await expect(manager.shutdown()).rejects.toThrow()
      else await manager.shutdown()
      expect(loadSession(project, active.id)?.messages.map(message => message.id)).toEqual(['before', 'tail'])
      expect(cold.messagesLoaded).toBe(false)
      expect(loadSession(project, 'cold')?.name).toBe(external.name)
      if (!missing) {
        const saved = loadSession(project, 'metadata')!
        expect(saved.name).toBe(metadata.name)
        expect(saved.messages.map(message => message.id)).toEqual(['before'])
      }
      expect(deleting.runtimeState).toBe('deleting')
      expect(deleting.runtimeEpoch).toBe(7)
    } finally { manager.cleanup() }
  }
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
