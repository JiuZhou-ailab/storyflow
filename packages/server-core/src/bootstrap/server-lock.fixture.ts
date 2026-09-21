// A real contender controlled over stdin by the isolated lease acceptance test.
import { createInterface } from 'node:readline'
import { acquireServerLock, releaseServerLock } from './server-lock'
const logger = { info() {}, warn() {}, error() {}, debug() {} }
for await (const line of createInterface({ input: process.stdin })) {
  try {
    if (line === 'acquire') await acquireServerLock(logger)
    if (line === 'release') releaseServerLock()
    console.log(JSON.stringify({ ok: true, pid: process.pid }))
  } catch (error) { console.log(JSON.stringify({ ok: false, code: (error as { code?: string }).code })) }
}
