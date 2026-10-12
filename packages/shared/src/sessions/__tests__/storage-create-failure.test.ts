import { expect, it, spyOn } from 'bun:test'
import * as fs from 'node:fs'
import * as promises from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createSession, loadSession } from '../storage'

it('cleans a failed new session and permits a later retry without removing existing sessions', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'create-session-failure-'))
  const original = promises.rename
  const kept = await createSession(root, { name: 'kept' })
  const rename = spyOn(promises, 'rename').mockImplementation(async () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }) })
  try {
    await expect(createSession(root)).rejects.toMatchObject({ code: 'EBUSY' })
    expect(fs.readdirSync(join(root, '.craft-agent/sessions'))).toEqual([kept.id])
    rename.mockImplementation(original)
    const retried = await createSession(root)
    expect(loadSession(root, retried.id)?.id).toBe(retried.id)
    expect(loadSession(root, kept.id)?.name).toBe('kept')
  } finally {
    rename.mockRestore()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

it('retries mkdir occupancy asynchronously and accepts a concurrent directory creator', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'create-session-mkdir-'))
  const original = fs.mkdirSync
  let failed = false
  const mkdir = spyOn(fs, 'mkdirSync').mockImplementation(((path: any, options: any) => {
    if (!failed) { failed = true; throw Object.assign(new Error('busy'), { code: 'EPERM' }) }
    original(path, options)
    throw Object.assign(new Error('another creator'), { code: 'EEXIST' })
  }) as any)
  try {
    const session = await createSession(root)
    expect(loadSession(root, session.id)?.id).toBe(session.id)
  } finally {
    mkdir.mockRestore()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

it('does not discard a busy crash recovery candidate', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'session-recovery-busy-'))
  const session = await createSession(root)
  const path = join(root, '.craft-agent/sessions', session.id, 'session.jsonl')
  fs.copyFileSync(path, path + '.bak')
  const original = fs.statSync
  const stat = spyOn(fs, 'statSync').mockImplementation(((target: any, ...args: any[]) => {
    if (target === path + '.bak') throw Object.assign(new Error('busy'), { code: 'EBUSY' })
    return (original as any)(target, ...args)
  }) as any)
  try {
    const { recoverSessionFile } = await import('../storage')
    expect(() => recoverSessionFile(path, root)).toThrow('busy')
    expect(fs.existsSync(path + '.bak')).toBe(true)
  } finally {
    stat.mockRestore()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
