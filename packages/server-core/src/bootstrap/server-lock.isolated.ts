// input: A stale server lease left by an abruptly terminated process
// output: Regression proof that startup recovers the lease without manual deletion
// pos: Process-isolated coverage for the shared server bootstrap lock boundary

import { afterAll, afterEach, expect, test, setDefaultTimeout } from 'bun:test'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

function contender(identityUnavailable = false) {
  const process = spawn(Bun.which('bun')!, [join(import.meta.dir, 'server-lock.fixture.ts')], {
    env: { ...Bun.env, CRAFT_CONFIG_DIR: configDir, ...(identityUnavailable ? { CRAFT_TEST_IDENTITY_UNAVAILABLE: '1' } : {}) },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const exited = new Promise<void>(resolve => process.once('exit', () => resolve()))
  process.stdin.on('error', () => {}) // command() reports write failures when the ownership monitor exits.
  const lines = createInterface({ input: process.stdout })[Symbol.asyncIterator]()
  return {
    process,
    exited,
    async command(command: string): Promise<{ ok: boolean; code?: string }> {
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
