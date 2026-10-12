// input: Real contenders, legacy/torn lease records and OS boundary failures
// output: Regression proof of safe recovery, live-owner protection and bounded listen retries
// pos: Process-isolated coverage for the shared server bootstrap lock boundary

import { afterAll, afterEach, expect, test, setDefaultTimeout } from 'bun:test'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir, uptime } from 'node:os'
import { join } from 'node:path'

setDefaultTimeout(30_000)

// Unix socket paths are limited to ~104 bytes; macOS tmpdir() alone uses half of that.
const configDir = realpathSync(mkdtempSync(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'sf-lock-')))
const lockPath = join(configDir, '.server.lock')
const leasePath = join(configDir, '.server.lease')
process.env.CRAFT_CONFIG_DIR = configDir

const { acquireServerLock, releaseServerLock } = await import('./headless-start')

const logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
}

afterAll(() => {
  releaseServerLock()
  rmSync(configDir, { recursive: true, force: true })
})
afterEach(() => {
  releaseServerLock()
  rmSync(lockPath, { recursive: true, force: true })
  rmSync(leasePath, { recursive: true, force: true })
})

function contender(identityUnavailable = false, env: Record<string, string> = {}) {
  const process = spawn(Bun.which('bun')!, [join(import.meta.dir, 'server-lock.fixture.ts')], {
    env: { ...Bun.env, CRAFT_CONFIG_DIR: configDir, ...(identityUnavailable ? { CRAFT_TEST_IDENTITY_UNAVAILABLE: '1' } : {}), ...env },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const exited = new Promise<void>(resolve => process.once('exit', () => resolve()))
  process.stdin.on('error', () => {}) // command() reports write failures when the ownership monitor exits.
  const lines = createInterface({ input: process.stdout })[Symbol.asyncIterator]()
  return {
    process,
    exited,
    async command(command: string): Promise<{ ok: boolean; code?: string; listenAttempts: number; errors: string[] }> {
      await new Promise<void>((resolve, reject) => process.stdin.write(`${command}\n`, error => error ? reject(error) : resolve()))
      const result = await lines.next()
      if (result.done) throw new Error('Contender exited without a result')
      return JSON.parse(result.value)
    },
    async close() {
      if (process.exitCode !== null || process.signalCode !== null) return
      process.kill('SIGKILL')
      await exited
    },
  }
}

test('two real processes exclude a live expired owner and recover after actual process exit', async () => {
  const first = contender(), second = contender()
  try {
    expect(await first.command('acquire')).toMatchObject({ ok: true })
    const expired = new Date(Date.now() - 120_000)
    utimesSync(lockPath, expired, expired)
    utimesSync(leasePath, expired, expired)
    const denied = await second.command('acquire')
    expect(denied.ok).toBe(false)
    expect(['OWNER_ACTIVE', 'OWNER_UNKNOWN']).toContain(denied.code ?? '')
    await first.close()
    expect((await second.command('acquire')).ok).toBe(true)
    expect((await second.command('release')).ok).toBe(true)
  } finally {
    if (first.process.exitCode === null && first.process.signalCode === null) await first.close()
    await second.close()
  }
})

test('automatically takes over a v2 lease written before this boot when identity is unavailable', async () => {
  const first = contender(true)
  try {
    expect(await first.command('legacy-before-boot')).toMatchObject({ ok: true })
    expect(await first.command('acquire')).toMatchObject({ ok: true })
    expect(await first.command('release')).toMatchObject({ ok: true })
  } finally { await first.close() }
})

test('keeps a v2 lease written after boot unknown when identity is unavailable', async () => {
  const first = contender(true)
  try {
    expect(await first.command('legacy-after-boot')).toMatchObject({ ok: true })
    expect(await first.command('acquire')).toMatchObject({ ok: false, code: 'OWNER_UNKNOWN' })
  } finally { await first.close() }
})

test('sets aside torn pre-boot lease records and automatically takes ownership', async () => {
  const first = contender(true)
  try {
    expect(await first.command('torn-before-boot')).toMatchObject({ ok: true })
    expect(await first.command('acquire')).toMatchObject({ ok: true })
    expect(await first.command('release')).toMatchObject({ ok: true })
    const aside = readdirSync(configDir).filter(name => name.includes('.unrecognized-'))
    expect(aside).toHaveLength(2)
    for (const name of aside) rmSync(join(configDir, name), { recursive: true })
  } finally { await first.close() }
})

test('retries transient liveness listen failures before publishing an endpoint', async () => {
  const first = contender(false, { CRAFT_TEST_LISTEN_FAILURES: '2' })
  try {
    expect(await first.command('acquire')).toMatchObject({ ok: true, listenAttempts: 3 })
    expect(JSON.parse(readFileSync(lockPath, 'utf8')).livenessEndpoint).toBeString()
    expect(await first.command('release')).toMatchObject({ ok: true })
  } finally { await first.close() }
})

test.each([false, true])('exhausted liveness retries publish a protected endpoint-free lease (identity unavailable: %s)', async (identityUnavailable) => {
  const first = contender(identityUnavailable, { CRAFT_TEST_LISTEN_FAILURES: '99' })
  try {
    expect(await first.command('legacy-before-boot')).toMatchObject({ ok: true })
    const result = await first.command('acquire')
    expect(result).toMatchObject({ ok: true, listenAttempts: 3 })
    expect(result.errors).toEqual(['[bootstrap] Host liveness listen failed after 3 attempts (EACCES); continuing with process identity; unverifiable owners remain protected'])
    const previous = readFileSync(lockPath, 'utf8')
    for (const path of [lockPath, join(leasePath, readdirSync(leasePath)[0]!)]) {
      const owner = JSON.parse(readFileSync(path, 'utf8'))
      expect(owner).toMatchObject({ pid: first.process.pid, leaseVersion: 3 })
      expect(owner.livenessEndpoint).toBeUndefined()
    }
    await expect(acquireServerLock(logger)).rejects.toMatchObject({ code: identityUnavailable ? 'OWNER_UNKNOWN' : 'OWNER_ACTIVE' })
    expect(readFileSync(lockPath, 'utf8')).toBe(previous)
    expect(readdirSync(configDir).filter(name => name.startsWith('.server-acquire-'))).toHaveLength(0)
    expect(await first.command('release')).toMatchObject({ ok: true })
    await acquireServerLock(logger)
  } finally { await first.close() }
})

test.each(['startedAt', 'mtime', 'clock-margin'])('keeps ambiguous legacy timestamps unknown: %s', async (timestamp) => {
  const first = contender(true)
  try {
    await first.command('legacy-before-boot')
    const marker = join(leasePath, readdirSync(leasePath)[0]!)
    for (const path of [marker, lockPath]) {
      const oldTime = lstatSync(path).mtime
      if (timestamp === 'startedAt') {
        writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), startedAt: Date.now() }))
        utimesSync(path, oldTime, oldTime)
      } else {
        const time = new Date(timestamp === 'mtime' ? Date.now() : Date.now() - uptime() * 1000 - 60_000)
        utimesSync(path, time, time)
      }
    }
    expect(await first.command('acquire')).toMatchObject({ ok: false, code: 'OWNER_UNKNOWN' })
  } finally { await first.close() }
})

test.each([false, true])('a pre-boot timestamp never overrides live proof (legacy: %s)', async (legacy) => {
  const first = contender()
  try {
    await first.command('acquire')
    const time = new Date(Date.now() - uptime() * 1000 - 600_000)
    for (const path of [join(leasePath, readdirSync(leasePath)[0]!), lockPath]) {
      const owner = JSON.parse(readFileSync(path, 'utf8'))
      if (legacy) { delete owner.livenessEndpoint; owner.leaseVersion = 2 }
      writeFileSync(path, JSON.stringify({ ...owner, startedAt: time.getTime() }))
      utimesSync(path, time, time)
    }
    await expect(acquireServerLock(logger, { overrideUnverifiedOwner: true })).rejects.toMatchObject({ code: 'OWNER_ACTIVE' })
    await first.command('release')
  } finally { await first.close() }
})

test.each(['file', 'foreign-entry', 'empty-directory'])('recovers pre-boot unrecognized lease state: %s', async (shape) => {
  const time = new Date(Date.now() - uptime() * 1000 - 600_000)
  if (shape === 'file') writeFileSync(leasePath, 'unrecognized')
  else {
    mkdirSync(leasePath)
    if (shape === 'foreign-entry') {
      const path = join(leasePath, 'unrecognized')
      writeFileSync(path, 'unrecognized')
      utimesSync(path, time, time)
    }
  }
  utimesSync(leasePath, time, time)
  await acquireServerLock(logger)
  expect(JSON.parse(readFileSync(lockPath, 'utf8')).pid).toBe(process.pid)
  for (const name of readdirSync(configDir).filter(name => name.includes('.unrecognized-'))) {
    rmSync(join(configDir, name), { recursive: true })
  }
})

test('matching process identity stays active even when the PID permission probe fails', async () => {
  const first = contender(), second = contender(false, { CRAFT_TEST_KILL_DENIED: '1' })
  try {
    await first.command('acquire')
    const time = new Date(Date.now() - uptime() * 1000 - 600_000)
    for (const path of [join(leasePath, readdirSync(leasePath)[0]!), lockPath]) {
      const owner = JSON.parse(readFileSync(path, 'utf8'))
      delete owner.livenessEndpoint
      writeFileSync(path, JSON.stringify({ ...owner, leaseVersion: 2, startedAt: time.getTime() }))
      utimesSync(path, time, time)
    }
    expect(await second.command('acquire')).toMatchObject({ ok: false, code: 'OWNER_ACTIVE' })
  } finally { await first.close(); await second.close() }
})

test('a fresh entry keeps an unrecognized pre-boot compatibility directory unknown', async () => {
  mkdirSync(lockPath)
  writeFileSync(join(lockPath, 'unrecognized'), 'recent owner state')
  const time = new Date(Date.now() - uptime() * 1000 - 600_000)
  utimesSync(lockPath, time, time)
  await expect(acquireServerLock(logger)).rejects.toMatchObject({ code: 'OWNER_UNKNOWN' })
})

test('extra compatibility files cannot hide a provably live legacy owner', async () => {
  await acquireServerLock(logger)
  const owner = JSON.parse(readFileSync(lockPath, 'utf8'))
  releaseServerLock()
  delete owner.livenessEndpoint
  const time = new Date(Date.now() - uptime() * 1000 - 600_000)
  mkdirSync(lockPath)
  for (const entry of ['owner.json', 'unexpected']) {
    const path = join(lockPath, entry)
    writeFileSync(path, JSON.stringify({ ...owner, leaseVersion: 2, startedAt: time.getTime() }))
    utimesSync(path, time, time)
  }
  utimesSync(lockPath, time, time)
  await expect(acquireServerLock(logger)).rejects.toMatchObject({ code: 'OWNER_ACTIVE' })
})

test('an owner whose OS identity cannot be queried is still proved active, then recovered after exit', async () => {
  const first = contender(true)
  try {
    expect(await first.command('acquire')).toMatchObject({ ok: true })
    expect(JSON.parse(readFileSync(lockPath, 'utf8')).processIdentity).toBeUndefined()
    await expect(acquireServerLock(logger)).rejects.toMatchObject({ code: 'OWNER_ACTIVE' })
    await first.close()
    await acquireServerLock(logger)
    expect(existsSync(leasePath)).toBe(true)
  } finally { await first.close() }
})

test('a dead owner is recovered even when its PID now belongs to another live process', async () => {
  const first = contender(true)
  try {
    expect(await first.command('acquire')).toMatchObject({ ok: true })
    await first.close()
    // Model PID reuse: the recorded PID is alive but is not the exited Host.
    const marker = join(leasePath, readdirSync(leasePath)[0]!)
    for (const path of [marker, lockPath]) {
      writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), pid: process.ppid }))
    }
    await acquireServerLock(logger)
    expect(JSON.parse(readFileSync(lockPath, 'utf8')).pid).toBe(process.pid)
  } finally { await first.close() }
})

test('an explicit override recovers an unverifiable legacy owner but never a provably live one', async () => {
  writeFileSync(lockPath, JSON.stringify({ pid: process.ppid, startedAt: 1, leaseVersion: 1 }))
  await expect(acquireServerLock(logger)).rejects.toMatchObject({ code: 'OWNER_UNKNOWN' })
  await acquireServerLock(logger, { overrideUnverifiedOwner: true })
  expect(JSON.parse(readFileSync(lockPath, 'utf8')).pid).toBe(process.pid)
  releaseServerLock()

  const live = contender(true)
  try {
    expect(await live.command('acquire')).toMatchObject({ ok: true })
    await expect(acquireServerLock(logger, { overrideUnverifiedOwner: true })).rejects.toMatchObject({ code: 'OWNER_ACTIVE' })
  } finally { await live.close() }
})

test('an obsolete release cannot remove a replacement generation', async () => {
  const first = contender(), second = contender()
  try {
    expect((await first.command('acquire')).ok).toBe(true)
    // Simulate an external/old-version takeover; the new protocol itself refuses it.
    rmSync(lockPath, { force: true })
    rmSync(leasePath, { recursive: true })
    expect((await second.command('acquire')).ok).toBe(true)
    const replacement = readFileSync(lockPath, 'utf8')
    try { await first.command('release') }
    catch {
      // Slow OS identity queries may let the old owner's monitor exit first.
      await first.exited
      expect(first.process.exitCode).toBe(1)
    }
    expect(readFileSync(lockPath, 'utf8')).toBe(replacement)
    expect(existsSync(leasePath)).toBe(true)
    await second.command('release')
  } finally { await first.close(); await second.close() }
})

test('does not steal an expired lease from a live owner', async () => {
  mkdirSync(lockPath)
  writeFileSync(join(lockPath, 'owner.json'), JSON.stringify({ pid: process.ppid, startedAt: Date.now() }))
  const staleAt = new Date(Date.now() - 120_000)
  utimesSync(lockPath, staleAt, staleAt)

  await expect(acquireServerLock(logger)).rejects.toThrow('Another Storyflow server instance')
  rmSync(lockPath, { recursive: true, force: true })
})

test('recovers an expired server lease left by a killed process', async () => {
  mkdirSync(lockPath)
  writeFileSync(join(lockPath, 'owner.json'), JSON.stringify({ pid: 2_147_483_647, startedAt: Date.now() - 120_000 }))
  const staleAt = new Date(Date.now() - 120_000)
  utimesSync(lockPath, staleAt, staleAt)

  await acquireServerLock(logger)

  expect(lstatSync(lockPath).isFile()).toBe(true)
  expect(JSON.parse(readFileSync(lockPath, 'utf-8')).pid).toBe(process.pid)
  expect(lstatSync(leasePath).isDirectory()).toBe(true)
  releaseServerLock()
  expect(existsSync(lockPath)).toBe(false)
  expect(existsSync(leasePath)).toBe(false)
})

test('does not mistake an expired heartbeat for proof of PID reuse', async () => {
  writeFileSync(lockPath, JSON.stringify({ pid: process.ppid, startedAt: Date.now(), leaseVersion: 1 }))
  mkdirSync(leasePath)
  const staleAt = new Date(Date.now() - 120_000)
  utimesSync(lockPath, staleAt, staleAt)
  utimesSync(leasePath, staleAt, staleAt)

  await expect(acquireServerLock(logger)).rejects.toThrow()
  expect(JSON.parse(readFileSync(lockPath, 'utf-8')).pid).toBe(process.ppid)
  rmSync(lockPath, { force: true })
  rmSync(leasePath, { recursive: true, force: true })
})

test('reclaims a fresh lease whose owner process no longer exists', async () => {
  releaseServerLock()
  writeFileSync(lockPath, JSON.stringify({ pid: 2_147_483_647, startedAt: Date.now() - 600_000, leaseVersion: 1 }))
  mkdirSync(leasePath)

  await acquireServerLock(logger)

  expect(JSON.parse(readFileSync(lockPath, 'utf-8')).pid).toBe(process.pid)
  expect(lstatSync(leasePath).isDirectory()).toBe(true)
})

test('does not steal a fresh lease from a live owner', async () => {
  releaseServerLock()
  writeFileSync(lockPath, JSON.stringify({ pid: process.ppid, startedAt: Date.now(), leaseVersion: 1 }))
  mkdirSync(leasePath)

  await expect(acquireServerLock(logger)).rejects.toThrow('Another Storyflow server instance')
  rmSync(leasePath, { recursive: true, force: true })
})

test('does not steal a fresh compatibility lock while its owner is starting', async () => {
  releaseServerLock()
  writeFileSync(lockPath, JSON.stringify({ pid: process.ppid, startedAt: Date.now(), leaseVersion: 1 }))

  await expect(acquireServerLock(logger)).rejects.toThrow('may be starting')
  expect(JSON.parse(readFileSync(lockPath, 'utf-8')).pid).toBe(process.ppid)
})

test('legacy wall-clock changes never establish that a live owner exited', async () => {
  // An old timestamp models a forward clock correction or a backward correction
  // between OS process creation and the legacy owner's Date.now() acquisition.
  writeFileSync(lockPath, JSON.stringify({ pid: process.ppid, startedAt: 1, leaseVersion: 1 }))
  mkdirSync(leasePath)
  await expect(acquireServerLock(logger)).rejects.toMatchObject({ code: 'OWNER_UNKNOWN' })
  expect(JSON.parse(readFileSync(lockPath, 'utf8')).pid).toBe(process.ppid)
})

test('a torn lease marker blocks by default and is set aside, never deleted, on override', async () => {
  mkdirSync(leasePath)
  writeFileSync(join(leasePath, `owner-${crypto.randomUUID()}.json`), '')
  await expect(acquireServerLock(logger)).rejects.toMatchObject({ code: 'OWNER_UNKNOWN' })
  await acquireServerLock(logger, { overrideUnverifiedOwner: true })
  expect(JSON.parse(readFileSync(lockPath, 'utf8')).pid).toBe(process.pid)
  const aside = readdirSync(configDir).filter(name => name.startsWith('.server.lease.unrecognized-'))
  expect(aside).toHaveLength(1)
  expect(readdirSync(join(configDir, aside[0]!))).toHaveLength(1)
  rmSync(join(configDir, aside[0]!), { recursive: true })
})

test('a lease observed mid-release is retried instead of reported as unknown', async () => {
  // A releasing owner has removed compatibility and its marker but not yet rmdir'ed.
  mkdirSync(leasePath)
  setTimeout(() => rmSync(leasePath, { recursive: true, force: true }), 100)
  await acquireServerLock(logger)
  expect(JSON.parse(readFileSync(lockPath, 'utf8')).pid).toBe(process.pid)
})
