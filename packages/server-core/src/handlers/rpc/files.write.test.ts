import { existsSync, rmSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  HANDLED_CHANNELS,
  filterFileSearchSnapshot,
  registerFilesHandlers,
  summarizeFileSearchBatch,
} from './files'

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
    sessionManager: {} as HandlerDeps['sessionManager'],
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
        getMetadata: async () => null,
        process: async () => Buffer.from(''),
      },
    },
  }

  registerFilesHandlers(server, deps)

  const writeFile = handlers.get(RPC_CHANNELS.file.WRITE)
  const deleteFile = handlers.get(RPC_CHANNELS.file.DELETE)
  const createDirectory = handlers.get(RPC_CHANNELS.file.CREATE_DIRECTORY)
  const searchFiles = handlers.get(RPC_CHANNELS.fs.SEARCH)
  const searchFilesBatch = handlers.get(RPC_CHANNELS.fs.SEARCH_BATCH)
  if (!writeFile || !deleteFile || !createDirectory || !searchFiles || !searchFilesBatch) {
    throw new Error('file handlers not registered')
  }

  const ctx: RequestContext = {
    clientId: 'client-1',
    workspaceId: null,
    webContentsId: 1,
  }

  return { writeFile, deleteFile, createDirectory, searchFiles, searchFilesBatch, ctx }
}

describe('file write RPC registration', () => {
  it('registers the workspace-scoped text write channel', () => {
    expect(HANDLED_CHANNELS).toContain('file:write')
  })

  it('registers the workspace-scoped file delete channel', () => {
    expect(HANDLED_CHANNELS).toContain('file:delete')
  })

  it('registers the workspace-scoped directory creation channel', () => {
    expect(HANDLED_CHANNELS).toContain('file:createDirectory')
  })

  it('registers the batch filesystem search channel', () => {
    expect(HANDLED_CHANNELS).toContain('fs:searchBatch')
  })

  it('summarizes batch filesystem search profiling metadata without scanning', () => {
    expect(summarizeFileSearchBatch('/tmp/workspace', [
      { query: '正文', options: { mode: 'path' } },
      { query: '大纲.md', options: { mode: 'path' } },
    ])).toEqual({
      requestCount: 2,
      uniqueRootCount: 1,
    })

    expect(summarizeFileSearchBatch('/tmp/workspace', [])).toEqual({
      requestCount: 0,
      uniqueRootCount: 0,
    })
  })

  it('filters a shared filesystem search snapshot for multiple fuzzy queries', () => {
    const snapshot = [
      { name: '正文', path: '/workspace/正文', type: 'directory', relativePath: '正文' },
      { name: '01.md', path: '/workspace/正文/01.md', type: 'file', relativePath: '正文/01.md' },
      { name: '大纲.md', path: '/workspace/大纲.md', type: 'file', relativePath: '大纲.md' },
    ] as const

    expect(filterFileSearchSnapshot(snapshot, '正文').map(result => result.relativePath)).toEqual([
      '正文',
      '正文/01.md',
    ])
    expect(filterFileSearchSnapshot(snapshot, '大纲').map(result => result.relativePath)).toEqual([
      '大纲.md',
    ])
  })

  it('creates missing parent directories before writing text files', async () => {
    const { writeFile, ctx } = createFileHarness()
    const root = await mkdtemp(join(tmpdir(), 'craft-file-write-'))
    const targetPath = join(root, 'exports', 'novel-export-test', 'manuscript.md')

    try {
      await writeFile(ctx, targetPath, 'body')

      expect(await readFile(targetPath, 'utf-8')).toBe('body')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('deletes workspace text files', async () => {
    const { deleteFile, ctx } = createFileHarness()
    const root = await mkdtemp(join(homedir(), '.craft-file-delete-'))
    const targetPath = join(root, 'story', 'new-chapter.md')

    try {
      await mkdir(join(root, 'story'), { recursive: true })
      await writeFile(targetPath, 'body')

      await deleteFile(ctx, targetPath)

      expect(existsSync(targetPath)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('recursively creates export directories before file writes', async () => {
    const { createDirectory, ctx } = createFileHarness()
    const root = await mkdtemp(join(tmpdir(), 'craft-file-dir-'))
    const exportDir = join(root, 'exports', 'novel-export-test')

    try {
      await createDirectory(ctx, exportDir)

      expect(existsSync(exportDir)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('scopes exact directory searches to the requested subtree', async () => {
    const { searchFiles, ctx } = createFileHarness()
    const root = await mkdtemp(join(tmpdir(), 'craft-file-search-'))

    try {
      await mkdir(join(root, '正文', '第一卷'), { recursive: true })
      await writeFile(join(root, '正文', '第一卷', '01.md'), 'chapter')
      await writeFile(join(root, '正文-notes.md'), 'outside')

      const results = await searchFiles(ctx, root, '正文') as Array<{ relativePath: string }>

      expect(results.map(result => result.relativePath)).toContain('正文/第一卷/01.md')
      expect(results.map(result => result.relativePath)).not.toContain('正文-notes.md')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns no fuzzy fallback results for missing path-only searches', async () => {
    const { searchFiles, ctx } = createFileHarness()
    const root = await mkdtemp(join(tmpdir(), 'craft-file-search-path-'))

    try {
      await writeFile(join(root, '正文-notes.md'), 'outside')

      const results = await searchFiles(ctx, root, '正文', { mode: 'path' }) as Array<{ relativePath: string }>

      expect(results).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('can probe an exact directory without recursively listing descendants', async () => {
    const { searchFiles, ctx } = createFileHarness()
    const root = await mkdtemp(join(tmpdir(), 'craft-file-search-probe-'))

    try {
      await mkdir(join(root, '正文', '第一卷'), { recursive: true })
      await writeFile(join(root, '正文', '第一卷', '01.md'), 'chapter')

      const results = await searchFiles(ctx, root, '正文', {
        mode: 'path',
        includeDescendants: false,
      }) as Array<{ name: string; path: string; relativePath: string; type: string }>

      expect(results).toEqual([
        { name: '正文', path: join(root, '正文'), relativePath: '正文', type: 'directory' },
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('batches path probes through one filesystem search handler call', async () => {
    const { searchFilesBatch, ctx } = createFileHarness()
    const root = await mkdtemp(join(tmpdir(), 'craft-file-search-batch-'))

    try {
      await mkdir(join(root, '正文'), { recursive: true })
      await writeFile(join(root, '大纲.md'), 'outline')

      const results = await searchFilesBatch(ctx, root, [
        { query: '正文', options: { mode: 'path', includeDescendants: false } },
        { query: '大纲.md', options: { mode: 'path', includeDescendants: false } },
      ]) as Array<{ query: string; results: Array<{ relativePath: string }> }>

      expect(results.map(result => result.query)).toEqual(['正文', '大纲.md'])
      expect(results.flatMap(result => result.results.map(item => item.relativePath))).toEqual(['正文', '大纲.md'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
