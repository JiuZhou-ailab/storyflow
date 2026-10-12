// input: Native Electron boundary fakes, real files, and attachment RPC
// output: Picker/drop grants and renderer path-forgery regression coverage
// pos: Isolated integration test across preload, main, and the filesystem handler
import { afterAll, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { HandlerFn, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '@craft-agent/server-core/handlers'

const dir = mkdtempSync(join(tmpdir(), 'file-dialog-'))
process.env.CRAFT_CONFIG_DIR = dir
const picker = join(dir, 'picker.txt'), dropped = join(dir, 'dropped.txt'), secret = join(dir, 'secret.txt')
for (const path of [picker, dropped, secret]) writeFileSync(path, path)
const ipcHandlers = new Map<string, (...args: any[]) => any>()
const nativeFiles = new WeakMap<File, string>()
const frame = {}, sender = { mainFrame: frame }
let canceled = false
mock.module('electron', () => ({
  BrowserWindow: { fromWebContents: () => ({}), getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: { showOpenDialog: async () => ({ canceled, filePaths: [picker] }) },
  ipcMain: {
    handle: (name: string, fn: (...args: any[]) => any) => ipcHandlers.set(name, fn),
    on: (name: string, fn: (...args: any[]) => any) => ipcHandlers.set(name, fn),
  },
  ipcRenderer: {
    sendSync: (name: string, path: string) => {
      const event = { sender, senderFrame: frame, returnValue: undefined as boolean | undefined }
      ipcHandlers.get(name)?.(event, path)
      return event.returnValue
    },
  },
  webUtils: { getPathForFile: (file: File) => nativeFiles.get(file) ?? '' },
}))
const { registerUserFileDialogHandlers } = await import('../file-dialog')
const { getUserAttachmentPath } = await import('../../preload/user-attachment')
const { registerFilesHandlers } = await import('@craft-agent/server-core/handlers/rpc/files')
const { registerSettingsHandlers } = await import('@craft-agent/server-core/handlers/rpc/settings')
registerUserFileDialogHandlers()
const handlers = new Map<string, HandlerFn>()
const server: RpcServer = {
  handle: (name, fn) => { handlers.set(name, fn) },
  push() {},
  invokeClient: async () => ({ canceled: false, filePaths: [secret] }),
}
const deps = {
  platform: {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    imageProcessor: { process: async () => { throw new Error('not an image') } },
  },
} as unknown as HandlerDeps
registerFilesHandlers(server, deps)
registerSettingsHandlers(server, deps)
const read = (path: string) => handlers.get('file:readUserAttachment')!({ clientId: 'test', webContentsId: 1, workspaceId: null }, path)
afterAll(() => rmSync(dir, { recursive: true, force: true }))

it('grants only completed native picker results', async () => {
  const open = ipcHandlers.get('__dialog:showOpenDialog')!
  expect(await read(picker)).toBeNull()
  canceled = true
  await open({ sender, senderFrame: frame }, {})
  expect(await read(picker)).toBeNull()
  canceled = false
  expect((await open({ sender, senderFrame: frame }, {})).filePaths).toEqual([picker])
  expect((await read(picker))?.text).toBe(picker)
})

it('registers native drops synchronously and rejects synthetic File path forgery', async () => {
  const forged = Object.assign(new File(['fake'], 'secret.txt'), { path: secret })
  expect(getUserAttachmentPath(forged)).toBeNull()
  expect(await read(secret)).toBeNull()
  const file = new File(['native'], 'dropped.txt')
  nativeFiles.set(file, dropped)
  expect(getUserAttachmentPath(file)).toBe(dropped)
  expect((await read(dropped))?.text).toBe(dropped)
})

it('does not authorize a new target when a granted symlink is retargeted', async () => {
  const alias = join(dir, 'drop-link.txt')
  symlinkSync(dropped, alias)
  const file = new File(['native'], 'drop-link.txt')
  nativeFiles.set(file, alias)
  expect(getUserAttachmentPath(file)).toBe(alias)
  unlinkSync(alias)
  symlinkSync(secret, alias)
  expect(await read(alias)).toBeNull()
})

it('does not turn renderer-supplied capability responses or subframes into grants', async () => {
  const response = await handlers.get('file:openDialog')!({ clientId: 'test', webContentsId: 1, workspaceId: null })
  expect(response).toEqual([secret])
  expect(await read(secret)).toBeNull()
  const event = { sender, senderFrame: {}, returnValue: undefined as boolean | undefined }
  ipcHandlers.get('__files:registerUserAttachment')!(event, secret)
  expect(event.returnValue).toBe(false)
  expect(await read(secret)).toBeNull()
})

it('strips renderer-forged draft paths while retaining text and rejects direct reads', async () => {
  await handlers.get('drafts:set')!({ clientId: 'test', webContentsId: 1, workspaceId: null }, 'attack', {
    text: 'keep my text', attachments: [{ path: secret, name: 'secret.txt' }],
  })
  expect(await read(secret)).toBeNull()
  const draft = await handlers.get('drafts:get')!({ clientId: 'test', webContentsId: 1, workspaceId: null }, 'attack')
  expect(draft.text).toBe('keep my text')
  expect(draft.attachments ?? []).toEqual([])
})

it('persists native grants and inline content without turning inline paths into disk grants', async () => {
  const ctx = { clientId: 'test', webContentsId: 1, workspaceId: null }
  const set = (draft: unknown) => handlers.get('drafts:set')!(ctx, 'content', draft)
  await set({ text: '', attachments: [{ path: picker, name: 'picked' }, { path: secret, name: 'inline', content: { type: 'text', mimeType: 'text/plain', size: 11, text: 'pasted text' } }] })
  const draft = await handlers.get('drafts:get')!(ctx, 'content')
  expect(draft.attachments).toHaveLength(2)
  expect(draft.attachments[1].path).toBe('inline:inline')
  expect(await read(secret)).toBeNull()
  await set({ ...draft, attachments: draft.attachments.map(({ content, ...ref }: any) => ref) })
  expect((await handlers.get('drafts:get')!(ctx, 'content')).attachments).toEqual([{ path: picker, name: 'picked' }])
  expect(await read(secret)).toBeNull()
})

it('does not persist a disk grant when storage discards malformed inline content', async () => {
  const ctx = { clientId: 'test', webContentsId: 1, workspaceId: null }
  await handlers.get('drafts:set')!(ctx, 'malformed', {
    text: 'retained', attachments: [{ path: secret, name: 'forged', content: 'invalid' }],
  })
  const { readFileSync } = await import('node:fs')
  const disk = JSON.parse(readFileSync(join(dir, 'drafts.json'), 'utf8'))
  expect(disk.drafts.malformed.attachments[0].path).toBe('inline:forged')
  expect(await read(secret)).toBeNull()
})
