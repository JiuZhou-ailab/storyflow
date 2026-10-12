// A real contender controlled over stdin by the isolated lease acceptance test.
import { createInterface } from 'node:readline'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { uptime } from 'node:os'
import { join } from 'node:path'
let listenAttempts = 0
if (process.env.CRAFT_TEST_KILL_DENIED === '1') {
  process.kill = () => { throw Object.assign(new Error('Injected permission denial'), { code: 'EPERM' }) }
}
if (process.env.CRAFT_TEST_LISTEN_FAILURES) {
  const { mock } = await import('bun:test')
  const net = { ...await import('node:net') }
  mock.module('node:net', () => ({ ...net, createServer(...args: any[]) {
    const server = (net.createServer as any)(...args)
    const listen = server.listen.bind(server)
    server.listen = (...args: any[]) => {
      if (++listenAttempts <= Number(process.env.CRAFT_TEST_LISTEN_FAILURES)) {
        queueMicrotask(() => server.emit('error', Object.assign(new Error('Injected listen refusal'), { code: 'EACCES' })))
        return server
      }
      return listen(...args)
    }
    return server
  } }))
}
if (process.env.CRAFT_TEST_IDENTITY_UNAVAILABLE === '1') {
  const { mock } = await import('bun:test')
  const childProcess = { ...await import('node:child_process') }
  const fs = { ...await import('node:fs') }
  mock.module('node:child_process', () => ({ ...childProcess, execFileSync() { throw new Error('Identity probe unavailable') } }))
  mock.module('node:fs', () => ({ ...fs, readFileSync(path: any, ...args: any[]) {
    if (typeof path === 'string' && path.startsWith('/proc/')) throw new Error('Identity probe unavailable')
    return (fs.readFileSync as any)(path, ...args)
  } }))
}
const { acquireServerLock, releaseServerLock } = await import('./server-lock')
const errors: string[] = []
const logger = { info() {}, warn() {}, error(message: string) { errors.push(message) }, debug() {} }
for await (const line of createInterface({ input: process.stdin })) {
  try {
    if (['legacy-before-boot', 'legacy-after-boot', 'torn-before-boot'].includes(line)) {
      const root = process.env.CRAFT_CONFIG_DIR!
      const startedAt = line === 'legacy-after-boot' ? Date.now() : Date.now() - uptime() * 1000 - 600_000
      const acquisitionId = crypto.randomUUID()
      const owner = { pid: process.ppid, startedAt, acquisitionId, leaseVersion: 2 }
      const lease = join(root, '.server.lease')
      const marker = join(lease, `owner-${acquisitionId}.json`)
      const compatibility = join(root, '.server.lock')
      mkdirSync(lease)
      for (const path of [marker, compatibility]) {
        writeFileSync(path, line === 'torn-before-boot' ? '' : JSON.stringify(owner))
        utimesSync(path, new Date(startedAt), new Date(startedAt))
      }
      utimesSync(lease, new Date(startedAt), new Date(startedAt))
    }
    if (line === 'acquire') await acquireServerLock(logger)
    if (line === 'release') releaseServerLock()
    console.log(JSON.stringify({ ok: true, pid: process.pid, listenAttempts, errors }))
  } catch (error) { console.log(JSON.stringify({ ok: false, code: (error as { code?: string }).code, listenAttempts, errors })) }
}
