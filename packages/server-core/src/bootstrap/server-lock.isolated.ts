// input: A stale server lease left by an abruptly terminated process
// output: Regression proof that startup recovers the lease without manual deletion
// pos: Process-isolated coverage for the shared server bootstrap lock boundary

import { afterAll, expect, test } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const configDir = mkdtempSync(join(tmpdir(), 'storyflow-server-lock-'))
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

test('does not steal an expired lease from a live owner', async () => {
  mkdirSync(lockPath)
  writeFileSync(join(lockPath, 'owner.json'), JSON.stringify({ pid: process.ppid, startedAt: Date.now() }))
  const staleAt = new Date(Date.now() - 120_000)
  utimesSync(lockPath, staleAt, staleAt)

  await expect(acquireServerLock(logger)).rejects.toThrow('Another Storyflow server instance is active')
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

test('uses the heartbeat lease instead of a reused PID', async () => {
  writeFileSync(lockPath, JSON.stringify({ pid: process.ppid, startedAt: Date.now(), leaseVersion: 1 }))
  mkdirSync(leasePath)
  const staleAt = new Date(Date.now() - 120_000)
  utimesSync(lockPath, staleAt, staleAt)
  utimesSync(leasePath, staleAt, staleAt)

  await acquireServerLock(logger)

  expect(JSON.parse(readFileSync(lockPath, 'utf-8')).pid).toBe(process.pid)
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

  await expect(acquireServerLock(logger)).rejects.toThrow('is active')
  rmSync(leasePath, { recursive: true, force: true })
})

test('does not steal a fresh compatibility lock while its owner is starting', async () => {
  releaseServerLock()
  writeFileSync(lockPath, JSON.stringify({ pid: process.ppid, startedAt: Date.now(), leaseVersion: 1 }))

  await expect(acquireServerLock(logger)).rejects.toThrow('may be starting')
  expect(JSON.parse(readFileSync(lockPath, 'utf-8')).pid).toBe(process.ppid)
})
