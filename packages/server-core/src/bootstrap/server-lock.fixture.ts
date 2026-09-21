// A real contender controlled over stdin by the isolated lease acceptance test.
import { createInterface } from 'node:readline'
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
const logger = { info() {}, warn() {}, error() {}, debug() {} }
for await (const line of createInterface({ input: process.stdin })) {
  try {
    if (line === 'acquire') await acquireServerLock(logger)
    if (line === 'release') releaseServerLock()
    console.log(JSON.stringify({ ok: true, pid: process.pid }))
  } catch (error) { console.log(JSON.stringify({ ok: false, code: (error as { code?: string }).code })) }
}
