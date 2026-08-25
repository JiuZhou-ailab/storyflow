// input: A stale server lease left by an abruptly terminated process
// output: Regression proof that startup recovers the lease without manual deletion
// pos: Process-isolated coverage for the shared server bootstrap lock boundary

import { afterAll, expect, test } from 'bun:test'
import { lstatSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const configDir = mkdtempSync(join(tmpdir(), 'storyflow-server-lock-'))
const lockPath = join(configDir, '.server.lock')
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
  const staleAt = new Date(Date.now() - 120_000)
  utimesSync(lockPath, staleAt, staleAt)

  await acquireServerLock(logger)

  expect(lstatSync(lockPath).isDirectory()).toBe(true)
})
