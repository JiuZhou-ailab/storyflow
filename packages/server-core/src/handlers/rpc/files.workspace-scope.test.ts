// input: Workspace-scoped RPC file paths and mocked workspace config lookup
// output: Regression coverage for project-root filesystem isolation
// pos: Guards file CRUD/search from escaping the active workspace id

import { existsSync, rmSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { StoreAttachmentResult } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

const require = createRequire(import.meta.url)
const realFsPromises = require('node:fs/promises') as typeof import('node:fs/promises')

let workspaceRootPath = ''
let workspaceRootRealpathCalls = 0
let trackedReaddirPath = ''
let trackedReaddirCalls = 0
let trackedReaddirDelay: Promise<void> | null = null
let attachmentSessionPath = ''
let attachmentImageMetadata: { width: number; height: number } | null = null
let attachmentProcessedImage = Buffer.from('')

mock.module('fs/promises', () => ({
  ...realFsPromises,
  realpath: async (...args: Parameters<typeof realFsPromises.realpath>) => {
    if (String(args[0]) === workspaceRootPath) {
      workspaceRootRealpathCalls += 1
    }
    return realFsPromises.realpath(...args)
  },
  readdir: async (...args: Parameters<typeof realFsPromises.readdir>) => {
    if (String(args[0]) === trackedReaddirPath) {
      trackedReaddirCalls += 1
      await trackedReaddirDelay
    }
    return realFsPromises.readdir(...args)
  },
}))

const { registerFilesHandlers } = await import('./files')

function createFileHarness() {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push() {},
    async invokeClient() {
      return undefined
    },
  }
  const deps: HandlerDeps = {
    sessionManager: {
      getSessionPath: () => attachmentSessionPath || null,
    } as unknown as HandlerDeps['sessionManager'],
    resolveRuntimeWorkspace: (id: string) => id === 'workspace-1'
      ? {
          id,
          name: 'Workspace',
          rootPath: workspaceRootPath,
          slug: 'workspace',
          createdAt: 0,
        }
      : null,
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      imageProcessor: {
        getMetadata: async () => attachmentImageMetadata,
        process: async () => attachmentProcessedImage,
      },
    },
  }

  registerFilesHandlers(server, deps)

  const writeTextFile = handlers.get(RPC_CHANNELS.file.WRITE)
  const searchFiles = handlers.get(RPC_CHANNELS.fs.SEARCH)
  const searchFilesBatch = handlers.get(RPC_CHANNELS.fs.SEARCH_BATCH)
  const listWorkspaceFiles = handlers.get(RPC_CHANNELS.fs.LIST_FILES)
  const storeAttachment = handlers.get(RPC_CHANNELS.file.STORE_ATTACHMENT)
  if (!writeTextFile || !searchFiles || !searchFilesBatch || !listWorkspaceFiles || !storeAttachment) {
    throw new Error('file handlers not registered')
  }

  const ctx: RequestContext = {
    clientId: 'client-1',
    workspaceId: 'workspace-1',
    webContentsId: 1,
  }

  return { writeTextFile, searchFiles, searchFilesBatch, listWorkspaceFiles, storeAttachment, ctx }
}

describe('workspace-scoped file RPCs', () => {
  it('keeps write and search operations inside the active workspace root', async () => {
    workspaceRootPath = await mkdtemp(join(tmpdir(), 'craft-workspace-root-'))
    const outsideRoot = await mkdtemp(join(tmpdir(), 'craft-workspace-outside-'))
    const { writeTextFile, searchFiles, searchFilesBatch, listWorkspaceFiles, ctx } = createFileHarness()

    try {
      await mkdir(join(workspaceRootPath, '正文'), { recursive: true })
      await writeFile(join(workspaceRootPath, '正文', '01.md'), 'inside')
      await writeFile(join(outsideRoot, 'outside.md'), 'outside')

      const insideResults = await searchFiles(ctx, workspaceRootPath, '正文', { maxResults: 10 }) as Array<{ relativePath: string }>
      expect(insideResults.map(result => result.relativePath)).toContain('正文/01.md')

      await expect(writeTextFile(ctx, join(outsideRoot, 'outside-write.md'), 'bad')).rejects.toThrow('outside current workspace')
      expect(existsSync(join(outsideRoot, 'outside-write.md'))).toBe(false)

      await expect(searchFiles(ctx, outsideRoot, '', { maxResults: 10 })).rejects.toThrow('outside current workspace')
      await expect(searchFilesBatch(ctx, outsideRoot, [{ query: '' }])).rejects.toThrow('outside current workspace')
      await expect(listWorkspaceFiles(ctx, outsideRoot, ['正文'])).rejects.toThrow('outside current workspace')
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true })
      rmSync(outsideRoot, { recursive: true, force: true })
      workspaceRootPath = ''
    }
  })

  it('rejects writes to missing files through a workspace symlink that escapes the root', async () => {
    workspaceRootPath = await mkdtemp(join(tmpdir(), 'craft-workspace-symlink-root-'))
    const outsideRoot = await mkdtemp(join(tmpdir(), 'craft-workspace-symlink-outside-'))
    const linkedDirectory = join(workspaceRootPath, 'linked-outside')
    const escapedTarget = join(linkedDirectory, 'created.md')
    const { writeTextFile, ctx } = createFileHarness()

    try {
      await symlink(outsideRoot, linkedDirectory, 'dir')

      await expect(writeTextFile(ctx, escapedTarget, 'bad')).rejects.toThrow('outside current workspace')
      expect(existsSync(join(outsideRoot, 'created.md'))).toBe(false)
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true })
      rmSync(outsideRoot, { recursive: true, force: true })
      workspaceRootPath = ''
    }
  })

  it('rejects attachment writes when the session belongs to another runtime domain', async () => {
    workspaceRootPath = await mkdtemp(join(tmpdir(), 'craft-workspace-attachment-root-'))
    const outsideRoot = await mkdtemp(join(tmpdir(), 'craft-workspace-attachment-outside-'))
    attachmentSessionPath = join(outsideRoot, 'sessions', 'session-1')
    const { storeAttachment, ctx } = createFileHarness()

    try {
      await mkdir(attachmentSessionPath, { recursive: true })

      await expect(storeAttachment(ctx, 'session-1', {
        type: 'text',
        path: '/tmp/note.txt',
        name: 'note.txt',
        mimeType: 'text/plain',
        text: 'x',
        size: 1,
      })).rejects.toThrow('outside current workspace')
      expect(existsSync(join(attachmentSessionPath, 'attachments'))).toBe(false)
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true })
      rmSync(outsideRoot, { recursive: true, force: true })
      workspaceRootPath = ''
      attachmentSessionPath = ''
    }
  })

  it('stores original bytes as the attachment truth and keeps model bytes out of persistence', async () => {
    workspaceRootPath = await mkdtemp(join(tmpdir(), 'craft-workspace-attachment-store-'))
    attachmentSessionPath = join(workspaceRootPath, '.craft-agent', 'sessions', 'session-1')
    const { storeAttachment, ctx } = createFileHarness()
    const original = Buffer.from('complete original text', 'utf8')

    try {
      await mkdir(attachmentSessionPath, { recursive: true })
      const result = await storeAttachment(ctx, 'session-1', {
        type: 'text',
        path: '/tmp/note.txt',
        name: 'note.txt',
        mimeType: 'text/plain',
        base64: original.toString('base64'),
        text: 'truncated preview',
        size: original.length,
      }) as StoreAttachmentResult

      expect(await readFile(result.attachment.storedPath)).toEqual(original)
      expect(result.attachment.size).toBe(original.length)
      expect(result.attachment.representations?.find(item => item.kind === 'original')).toMatchObject({
        path: result.attachment.storedPath,
        size: original.length,
        sha256: createHash('sha256').update(original).digest('hex'),
      })
      expect(result.modelInputBase64).toBeUndefined()
      expect('resizedBase64' in result.attachment).toBe(false)
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true })
      workspaceRootPath = ''
      attachmentSessionPath = ''
    }
  })

  it('stores optimized model images as a separate derived representation', async () => {
    workspaceRootPath = await mkdtemp(join(tmpdir(), 'craft-workspace-attachment-image-'))
    attachmentSessionPath = join(workspaceRootPath, '.craft-agent', 'sessions', 'session-1')
    attachmentImageMetadata = { width: 2000, height: 1000 }
    attachmentProcessedImage = Buffer.from('bounded model image', 'utf8')
    const { storeAttachment, ctx } = createFileHarness()
    const original = Buffer.from('immutable original image', 'utf8')

    try {
      await mkdir(attachmentSessionPath, { recursive: true })
      const result = await storeAttachment(ctx, 'session-1', {
        type: 'image',
        path: '/tmp/image.png',
        name: 'image.png',
        mimeType: 'image/png',
        base64: original.toString('base64'),
        size: original.length,
      }) as StoreAttachmentResult

      expect(await readFile(result.attachment.storedPath)).toEqual(original)
      const modelInput = result.attachment.representations?.find(item => item.kind === 'model-input')
      expect(modelInput).toBeDefined()
      expect(await readFile(modelInput!.path)).toEqual(attachmentProcessedImage)
      expect(result.modelInputBase64).toBe(attachmentProcessedImage.toString('base64'))
      expect(result.modelInputMimeType).toBe('image/png')
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true })
      workspaceRootPath = ''
      attachmentSessionPath = ''
      attachmentImageMetadata = null
      attachmentProcessedImage = Buffer.from('')
    }
  })

  it('reuses workspace root realpath across scoped operations', async () => {
    workspaceRootPath = await mkdtemp(join(tmpdir(), 'craft-workspace-root-cache-'))
    workspaceRootRealpathCalls = 0
    const { writeTextFile, searchFiles, searchFilesBatch, listWorkspaceFiles, ctx } = createFileHarness()

    try {
      const manuscriptDir = join(workspaceRootPath, '正文')
      await mkdir(manuscriptDir, { recursive: true })
      await writeFile(join(manuscriptDir, '01.md'), 'inside')

      await searchFiles(ctx, manuscriptDir, '01.md', { maxResults: 10 })
      await searchFilesBatch(ctx, manuscriptDir, [{ query: '01.md', options: { mode: 'path' } }])
      await listWorkspaceFiles(ctx, workspaceRootPath, ['正文'])
      await writeTextFile(ctx, join(manuscriptDir, '02.md'), 'new')

      expect(workspaceRootRealpathCalls).toBe(1)
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true })
      workspaceRootPath = ''
      workspaceRootRealpathCalls = 0
    }
  })

  it('does not scan a child root twice when a parent root already covers it', async () => {
    workspaceRootPath = await mkdtemp(join(tmpdir(), 'craft-workspace-root-list-'))
    const { listWorkspaceFiles, ctx } = createFileHarness()

    try {
      const chaptersDir = join(workspaceRootPath, 'story', 'chapters')
      await mkdir(chaptersDir, { recursive: true })
      await writeFile(join(chaptersDir, '01.md'), 'chapter')
      trackedReaddirPath = chaptersDir
      trackedReaddirCalls = 0

      const results = await listWorkspaceFiles(ctx, workspaceRootPath, ['story', 'story/chapters']) as Array<{ relativePath: string }>

      expect(results.map(result => result.relativePath)).toEqual(['story/chapters/01.md'])
      expect(trackedReaddirCalls).toBe(1)
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true })
      workspaceRootPath = ''
      trackedReaddirPath = ''
      trackedReaddirCalls = 0
    }
  })

  it('coalesces identical concurrent filesystem searches', async () => {
    workspaceRootPath = await mkdtemp(join(tmpdir(), 'craft-workspace-root-search-coalesce-'))
    const { searchFiles, ctx } = createFileHarness()
    let releaseReaddir = () => {}

    try {
      await mkdir(join(workspaceRootPath, '正文'), { recursive: true })
      await writeFile(join(workspaceRootPath, '正文', '01.md'), 'chapter')
      trackedReaddirPath = workspaceRootPath
      trackedReaddirCalls = 0
      trackedReaddirDelay = new Promise<void>(resolve => {
        releaseReaddir = resolve
      })

      const searchPromise = Promise.all([
        searchFiles(ctx, workspaceRootPath, '01', { maxResults: 10 }),
        searchFiles(ctx, workspaceRootPath, '01', { maxResults: 10 }),
      ]) as Promise<Array<Array<{ relativePath: string }>>>

      await Promise.resolve()
      releaseReaddir()
      const [first, second] = await searchPromise

      expect(second).toEqual(first)
      expect(first.map(result => result.relativePath)).toContain('正文/01.md')
      expect(trackedReaddirCalls).toBe(1)
    } finally {
      releaseReaddir()
      rmSync(workspaceRootPath, { recursive: true, force: true })
      workspaceRootPath = ''
      trackedReaddirPath = ''
      trackedReaddirCalls = 0
      trackedReaddirDelay = null
    }
  })
})
