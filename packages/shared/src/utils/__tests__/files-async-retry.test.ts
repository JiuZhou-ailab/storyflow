import { expect, it } from 'bun:test'
import { retryTransientFs, classifyFsError } from '../files'

it('retries a busy operation asynchronously and preserves its result', async () => {
  let attempts = 0
  let yielded = false
  setTimeout(() => { yielded = true }, 0)
  const result = await retryTransientFs(() => {
    if (++attempts < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY', path: '/session' })
    return 'saved'
  }, { attempts: 3, delays: [5] })
  expect(result).toBe('saved')
  expect(attempts).toBe(3)
  expect(yielded).toBe(true)
  expect(classifyFsError({ code: 'EBUSY', path: '/session' })).toEqual({ kind: 'transient', code: 'EBUSY', path: '/session' })
})

it.each(['EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENOTEMPTY', 'ENOENT', 'ENOSPC'])('bounds retries and preserves %s errors', async code => {
  let calls = 0
  const error = Object.assign(new Error(code), { code, path: '/session' })
  await expect(retryTransientFs(() => { calls++; throw error }, { attempts: 3, delays: [0] })).rejects.toBe(error)
  expect(calls).toBe(['ENOENT', 'ENOSPC'].includes(code) ? 1 : 3)
})

it('loads where SharedArrayBuffer is unavailable, as in renderer preloads', async () => {
  const original = globalThis.SharedArrayBuffer
  // @ts-expect-error simulate a preload without cross-origin isolation
  delete globalThis.SharedArrayBuffer
  try {
    await expect(import(`../files.ts?no-sab=${Date.now()}`)).resolves.toBeDefined()
  } finally {
    globalThis.SharedArrayBuffer = original
  }
})
