// input: Real temp files plus fs spies that inject Windows-style sharing violations
// output: Regression proof that transient file-sharing errors are retried and real errors are not
// pos: Guards the shared atomic write / JSON read boundary against intermittent Windows locks

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import * as fs from 'node:fs'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteFileSync, readJsonFileSync } from '../files.ts'

function errnoError(code: string): NodeJS.ErrnoException {
  const error = new Error(`${code}: simulated`) as NodeJS.ErrnoException
  error.code = code
  return error
}

function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { ...original, value: platform })
  try {
    return run()
  } finally {
    Object.defineProperty(process, 'platform', original)
  }
}

describe('transient file-sharing retry', () => {
  let dir: string
  const restores: Array<() => void> = []

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'storyflow-files-retry-'))
  })

  afterEach(() => {
    while (restores.length) restores.pop()!()
    rmSync(dir, { recursive: true, force: true })
  })

  function failFirst<K extends 'renameSync' | 'readFileSync'>(name: K, codes: string[]) {
    const original = fs[name] as (...args: unknown[]) => unknown
    let calls = 0
    const spy = spyOn(fs, name).mockImplementation(((...args: unknown[]) => {
      calls += 1
      const code = codes[calls - 1]
      if (code) throw errnoError(code)
      return original(...args)
    }) as never)
    restores.push(() => spy.mockRestore())
    return { get calls() { return calls } }
  }

  it('atomicWriteFileSync succeeds when renameSync fails once with EBUSY', () => {
    const target = join(dir, 'config.json')
    writeFileSync(target, '{"v":1}')
    const rename = failFirst('renameSync', ['EBUSY'])

    atomicWriteFileSync(target, '{"v":2}')

    expect(rename.calls).toBe(2)
    expect(readFileSync(target, 'utf-8')).toBe('{"v":2}')
    expect(readdirSync(dir)).toEqual(['config.json'])
  })

  it('atomicWriteFileSync retries EPERM on win32 (delete-pending / AV lock)', () => {
    const target = join(dir, 'config.json')
    const rename = failFirst('renameSync', ['EPERM', 'EACCES'])

    withPlatform('win32', () => atomicWriteFileSync(target, '{"v":3}'))

    expect(rename.calls).toBe(3)
    expect(readFileSync(target, 'utf-8')).toBe('{"v":3}')
  })

  it('atomicWriteFileSync does not retry EPERM on POSIX and cleans up the temp file', () => {
    const target = join(dir, 'config.json')
    const rename = failFirst('renameSync', ['EPERM'])

    expect(() => withPlatform('linux', () => atomicWriteFileSync(target, '{"v":4}'))).toThrow(/EPERM/)

    expect(rename.calls).toBe(1)
    expect(readdirSync(dir)).toEqual([])
  })

  it('atomicWriteFileSync gives up after a bounded number of EBUSY attempts and cleans up', () => {
    const target = join(dir, 'config.json')
    const rename = failFirst('renameSync', Array(50).fill('EBUSY'))

    expect(() => atomicWriteFileSync(target, '{"v":5}')).toThrow(/EBUSY/)

    expect(rename.calls).toBeGreaterThan(1)
    expect(rename.calls).toBeLessThanOrEqual(6)
    expect(readdirSync(dir)).toEqual([])
  })

  it('readJsonFileSync retries a transient EBUSY read', () => {
    const target = join(dir, 'config.json')
    writeFileSync(target, '﻿{"id":"x"}')
    const read = failFirst('readFileSync', ['EBUSY', 'EBUSY'])

    expect(readJsonFileSync<{ id: string }>(target)).toEqual({ id: 'x' })
    expect(read.calls).toBe(3)
  })

  it('readJsonFileSync does not retry ENOENT or POSIX EACCES', () => {
    const read = failFirst('readFileSync', ['EACCES'])
    expect(() => withPlatform('darwin', () => readJsonFileSync(join(dir, 'x.json')))).toThrow(/EACCES/)
    expect(read.calls).toBe(1)

    expect(() => readJsonFileSync(join(dir, 'missing.json'))).toThrow(/ENOENT/)
    expect(read.calls).toBe(2)
  })
})
