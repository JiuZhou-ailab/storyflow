// input: Registered file RPC and real project files
// output: Versioned text read/save, conflict and recovery acceptance
// pos: Filesystem RPC seam for interactive text editing
import { test, expect } from 'bun:test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RpcServer, HandlerFn, RequestContext } from '../../transport'
import type { HandlerDeps } from '../handler-deps'
import { registerFilesHandlers } from './files'

test('editing saves raw UTF-8 without changing BOM or CRLF and rejects an obsolete version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'text-document-'))
  try {
    const handlers = new Map<string, HandlerFn>()
    const server = { handle: (key: string, fn: HandlerFn) => handlers.set(key, fn) } as unknown as RpcServer
    const deps = {
      resolveRuntimeWorkspaceById: () => ({ id: 'project', rootPath: root }),
      sessionManager: { withProjectLifecycle: async (_: string, fn: () => Promise<unknown>) => fn() },
      platform: { logger: { info() {}, debug() {}, error() {}, warn() {} } },
    } as unknown as HandlerDeps
    registerFilesHandlers(server, deps)
    const ctx = { workspaceId: 'project', clientId: 'test', webContentsId: null } as RequestContext
    const path = join(root, 'document.json')
    await writeFile(path, '\uFEFF{ invalid\r\n')
    const read = handlers.get('file:readDocument')!
    const save = handlers.get('file:saveDocument')!
    expect(read).toBeDefined()
    const initial = await read(ctx, { path })
    expect(initial.content).toBe('{ invalid\n')
    const saved = await save(ctx, { path, version: initial.version, content: '{ edited\n' })
    expect(saved.status).toBe('saved')
    expect(await readFile(path, 'utf8')).toBe('\uFEFF{ edited\r\n')
    const conflict = await save(ctx, { path, version: initial.version, content: 'stale' })
    expect(conflict.status).toBe('conflict')
    expect(await readFile(path, 'utf8')).toBe('\uFEFF{ edited\r\n')
    const records = await handlers.get('file:listDocumentRecovery')!(ctx, { path })
    expect(records.length).toBe(1)
    const recovery = await handlers.get('file:readDocumentRecovery')!(ctx, { path, id: records[0].id })
    expect(recovery.before).toBe('\uFEFF{ invalid\r\n')
    expect(recovery.submitted).toBe('\uFEFF{ edited\r\n')
    expect((await save(ctx, { path, version: saved.version, content: '{ edited\n' })).status).toBe('saved')
    expect((await handlers.get('file:listDocumentRecovery')!(ctx, { path })).length).toBe(1)
    const recoveryRoot = join(root, '.craft-agent', 'text-recovery')
    await rm(recoveryRoot, { recursive: true })
    await writeFile(recoveryRoot, 'unavailable recovery directory')
    await expect(save(ctx, { path, version: saved.version, content: 'must not overwrite' })).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe('\uFEFF{ edited\r\n')
    await writeFile(path, 'mixed\r\nlines\n')
    expect((await read(ctx, { path })).readOnly).toBe(true)
    await writeFile(path, Buffer.from([0xff, 0xfe]))
    expect((await read(ctx, { path })).readOnly).toBe(true)

  } finally { await rm(root, { recursive: true, force: true }) }
})

test('conversation editing cannot write originals, sibling sessions or symlinks, and Save As is exclusive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'conversation-edit-'))
  try {
    const { mkdir, symlink } = await import('node:fs/promises')
    const session = join(root, 'session-a')
    await mkdir(join(session, 'work'), { recursive: true })
    await mkdir(join(session, 'attachments'))
    const path = join(session, 'work', 'draft.txt')
    const original = join(session, 'attachments', 'source.txt')
    await writeFile(path, 'draft')
    await writeFile(original, 'original')
    await writeFile(join(session, 'session.jsonl'), JSON.stringify({ id: 'session-a' }) + '\n' + JSON.stringify({ type: 'user', attachments: [{ name: 'source.txt', storedPath: original }] }) + '\n')
    const handlers = new Map<string, HandlerFn>()
    const server = { handle: (key: string, fn: HandlerFn) => handlers.set(key, fn) } as unknown as RpcServer
    const deps = {
      resolveRuntimeWorkspaceById: () => ({ id: '__storyflow_free__', rootPath: root }),
      sessionManager: {
        getSessions: () => [{ id: 'session-a' }],
        withSessionPathOperation: async (_: string, fn: (path: string) => Promise<unknown>) => fn(session),
      },
      platform: { logger: { info() {}, debug() {}, error() {}, warn() {} } },
    } as unknown as HandlerDeps
    registerFilesHandlers(server, deps)
    const ctx = { workspaceId: '__storyflow_free__', clientId: 'test', webContentsId: null } as RequestContext
    const read = handlers.get('file:readDocument')!
    const save = handlers.get('file:saveDocument')!
    const target = { path, sessionId: 'session-a' }
    const initial = await read(ctx, target)
    expect((await read(ctx, { ...target, path: original })).readOnly).toBe(true)
    await expect(save(ctx, { ...target, path: original, version: initial.version, content: 'changed' })).rejects.toThrow('immutable')
    await expect(read(ctx, { ...target, sessionId: 'sibling' })).rejects.toThrow('outside')
    await expect(save(ctx, { ...target, destination: join(session, 'session.jsonl'), version: initial.version, content: 'changed' })).rejects.toThrow('outside')
    await symlink(original, join(session, 'work', 'link.txt'))
    await expect(read(ctx, { ...target, path: join(session, 'work', 'link.txt') })).rejects.toThrow()
    const outcomes = await Promise.all(['one', 'two'].map(content => save(ctx, { ...target, version: initial.version, content })))
    expect(outcomes.map(outcome => outcome.status).sort()).toEqual(['conflict', 'saved'])
    const copy = join(session, 'work', 'copy.txt')
    expect((await save(ctx, { ...target, version: initial.version, content: 'copy', destination: copy })).status).toBe('saved')
    await expect(save(ctx, { ...target, version: initial.version, content: 'overwrite', destination: copy })).rejects.toThrow()
    expect(await readFile(copy, 'utf8')).toBe('copy')
    expect(await readFile(original, 'utf8')).toBe('original')
    await rm(path)
    expect((await save(ctx, { ...target, version: initial.version, content: 'resurrect' })).status).toBe('missing')
    expect((await save(ctx, { ...target, version: initial.version, content: 'retained', format: initial.format, destination: join(session, 'work', 'after-delete.txt') })).status).toBe('saved')
  } finally { await rm(root, { recursive: true, force: true }) }
})
