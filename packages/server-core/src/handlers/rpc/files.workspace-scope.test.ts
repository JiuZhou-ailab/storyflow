// input: Workspace-scoped RPC file paths and mocked workspace config lookup
// output: Regression coverage for project-root filesystem isolation
// pos: Guards file CRUD/search from escaping the active workspace id

import { existsSync, rmSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

let workspaceRootPath = ''

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) => id === 'workspace-1'
    ? {
        id,
        name: 'Workspace',
        rootPath: workspaceRootPath,
        slug: 'workspace',
      }
    : null,
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

  const writeTextFile = handlers.get(RPC_CHANNELS.file.WRITE)
  const searchFiles = handlers.get(RPC_CHANNELS.fs.SEARCH)
  const searchFilesBatch = handlers.get(RPC_CHANNELS.fs.SEARCH_BATCH)
  if (!writeTextFile || !searchFiles || !searchFilesBatch) {
    throw new Error('file handlers not registered')
  }

  const ctx: RequestContext = {
    clientId: 'client-1',
    workspaceId: 'workspace-1',
    webContentsId: 1,
  }

  return { writeTextFile, searchFiles, searchFilesBatch, ctx }
}

describe('workspace-scoped file RPCs', () => {
  it('keeps write and search operations inside the active workspace root', async () => {
    workspaceRootPath = await mkdtemp(join(tmpdir(), 'craft-workspace-root-'))
    const outsideRoot = await mkdtemp(join(tmpdir(), 'craft-workspace-outside-'))
    const { writeTextFile, searchFiles, searchFilesBatch, ctx } = createFileHarness()

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
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true })
      rmSync(outsideRoot, { recursive: true, force: true })
      workspaceRootPath = ''
    }
  })
})
