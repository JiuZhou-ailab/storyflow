import { existsSync, rmSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { HANDLED_CHANNELS, registerFilesHandlers } from './files'

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
  const createDirectory = handlers.get(RPC_CHANNELS.file.CREATE_DIRECTORY)
  if (!writeFile || !createDirectory) {
    throw new Error('file handlers not registered')
  }

  const ctx: RequestContext = {
    clientId: 'client-1',
    workspaceId: null,
    webContentsId: 1,
  }

  return { writeFile, createDirectory, ctx }
}

describe('file write RPC registration', () => {
  it('registers the workspace-scoped text write channel', () => {
    expect(HANDLED_CHANNELS).toContain('file:write')
  })

  it('registers the workspace-scoped directory creation channel', () => {
    expect(HANDLED_CHANNELS).toContain('file:createDirectory')
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
})
