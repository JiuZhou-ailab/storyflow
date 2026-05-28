import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { consumeLaunchUpdateCheckDecision } from '../auto-update-launch-policy'

const tempDirs: string[] = []

function makeUserDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'storyflow-update-launch-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('auto-update launch policy', () => {
  it('skips automatic update checks on first launch and records the installed version', () => {
    const userDataDir = makeUserDataDir()

    const decision = consumeLaunchUpdateCheckDecision({
      userDataDir,
      currentVersion: '0.9.22',
    })

    expect(decision).toEqual({ shouldCheck: false, reason: 'first-launch' })
    expect(existsSync(join(userDataDir, 'update-launch-state.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(userDataDir, 'update-launch-state.json'), 'utf8'))).toEqual({
      lastSeenVersion: '0.9.22',
    })
  })

  it('allows automatic update checks after the installed version has already launched once', () => {
    const userDataDir = makeUserDataDir()
    consumeLaunchUpdateCheckDecision({ userDataDir, currentVersion: '0.9.22' })

    const decision = consumeLaunchUpdateCheckDecision({
      userDataDir,
      currentVersion: '0.9.22',
    })

    expect(decision).toEqual({ shouldCheck: true })
  })

  it('skips automatic update checks once after an app version change', () => {
    const userDataDir = makeUserDataDir()
    consumeLaunchUpdateCheckDecision({ userDataDir, currentVersion: '0.9.21' })

    const decision = consumeLaunchUpdateCheckDecision({
      userDataDir,
      currentVersion: '0.9.22',
    })

    expect(decision).toEqual({ shouldCheck: false, reason: 'version-changed' })
    expect(JSON.parse(readFileSync(join(userDataDir, 'update-launch-state.json'), 'utf8'))).toEqual({
      lastSeenVersion: '0.9.22',
    })
  })
})
