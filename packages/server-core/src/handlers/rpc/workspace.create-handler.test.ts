// input: Workspace create RPC registration with Method Pack scaffolding
// output: Regression coverage for starter sessions and stale default workspace reuse
// pos: Guards the server-side boundary between workspace scaffolding and in-memory sessions

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { createNovelWorkspaceAtPath } from '@craft-agent/shared/workspaces'
import type { HandlerFn, RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

const createdWorkspaces: Array<{ id: string; name: string; rootPath: string; slug: string }> = []

mock.module('@craft-agent/shared/config', () => ({
  addWorkspace: ({ name, rootPath }: { name: string; rootPath: string }) => {
    const workspace = {
      id: `workspace-${createdWorkspaces.length + 1}`,
      name,
      rootPath,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'workspace',
    }
    createdWorkspaces.push(workspace)
    return workspace
  },
  getWorkspaceByNameOrId: (id: string) => createdWorkspaces.find(workspace => workspace.id === id) ?? null,
  getWorkspaces: () => createdWorkspaces,
  setActiveWorkspace: () => {},
  updateWorkspaceRemoteServer: () => {},
}))

const { registerWorkspaceCoreHandlers } = await import('./workspace')

function createWorkspaceHarness() {
  const handlers = new Map<string, HandlerFn>()
  let reloadSessionsCount = 0

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
      getWorkspaces: () => createdWorkspaces,
      reloadSessions: () => {
        reloadSessionsCount += 1
      },
    } as unknown as HandlerDeps['sessionManager'],
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

  registerWorkspaceCoreHandlers(server, deps)

  const createWorkspace = handlers.get(RPC_CHANNELS.workspaces.CREATE)
  if (!createWorkspace) {
    throw new Error('workspace create handler not registered')
  }
  const checkWorkspaceSlug = handlers.get(RPC_CHANNELS.workspaces.CHECK_SLUG)
  if (!checkWorkspaceSlug) {
    throw new Error('workspace slug check handler not registered')
  }

  const ctx: RequestContext = {
    clientId: 'client-1',
    workspaceId: null,
    webContentsId: 1,
  }

  return {
    createWorkspace,
    checkWorkspaceSlug,
    ctx,
    getReloadSessionsCount: () => reloadSessionsCount,
  }
}

describe('workspace create RPC registration', () => {
  it('reloads sessions after creating a novel workspace so starter chat appears immediately', async () => {
    createdWorkspaces.length = 0
    const rootPath = mkdtempSync(join(tmpdir(), 'craft-workspace-create-handler-'))
    const { createWorkspace, ctx, getReloadSessionsCount } = createWorkspaceHarness()

    try {
      await createWorkspace(ctx, rootPath, 'Book', { projectType: 'novel', methodPackId: 'novel.claude-book' })

      expect(getReloadSessionsCount()).toBe(1)
    } finally {
      rmSync(rootPath, { recursive: true, force: true })
    }
  })

  it('reinitializes an untracked stale default workspace folder before applying the selected method pack', async () => {
    createdWorkspaces.length = 0
    const slug = `craft-stale-default-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const rootPath = join(homedir(), '.craft-agent', 'workspaces', slug)
    rmSync(rootPath, { recursive: true, force: true })
    createNovelWorkspaceAtPath(rootPath, 'Old Book', undefined, 'novel.oh-story')
    const { createWorkspace, ctx } = createWorkspaceHarness()

    try {
      await createWorkspace(ctx, rootPath, 'Book', { projectType: 'novel', methodPackId: 'novel.claude-book' })

      const manifest = JSON.parse(readFileSync(join(rootPath, 'craft-writing.json'), 'utf-8')) as {
        methodPack?: { id?: string }
      }
      expect(manifest.methodPack?.id).toBe('novel.claude-book')
      expect(existsSync(join(rootPath, 'bible', 'style.md'))).toBe(true)
      expect(existsSync(join(rootPath, '大纲', '大纲.md'))).toBe(false)
    } finally {
      rmSync(rootPath, { recursive: true, force: true })
    }
  })

  it('does not reinitialize an existing custom workspace folder when creating at an explicit path', async () => {
    createdWorkspaces.length = 0
    const rootPath = mkdtempSync(join(tmpdir(), 'craft-custom-stale-workspace-'))
    createNovelWorkspaceAtPath(rootPath, 'Old Book', undefined, 'novel.oh-story')
    const { createWorkspace, ctx } = createWorkspaceHarness()

    try {
      await createWorkspace(ctx, rootPath, 'Book', { projectType: 'novel', methodPackId: 'novel.claude-book' })

      const manifest = JSON.parse(readFileSync(join(rootPath, 'craft-writing.json'), 'utf-8')) as {
        methodPack?: { id?: string }
      }
      expect(manifest.methodPack?.id).toBe('novel.oh-story')
      expect(existsSync(join(rootPath, '大纲', '大纲.md'))).toBe(true)
    } finally {
      rmSync(rootPath, { recursive: true, force: true })
    }
  })

  it('does not treat an untracked default workspace folder as a slug conflict', async () => {
    createdWorkspaces.length = 0
    const { checkWorkspaceSlug, ctx } = createWorkspaceHarness()

    const result = await checkWorkspaceSlug(ctx, 'workspace-2b7t9p')

    expect(result).toEqual({
      exists: false,
      path: expect.stringContaining(join('.craft-agent', 'workspaces', 'workspace-2b7t9p')),
    })
  })

  it('treats a tracked default workspace folder as a slug conflict', async () => {
    createdWorkspaces.length = 0
    const { checkWorkspaceSlug, ctx } = createWorkspaceHarness()
    createdWorkspaces.push({
      id: 'workspace-1',
      name: 'Existing',
      rootPath: join(process.env.HOME ?? '', '.craft-agent', 'workspaces', 'workspace-2b7t9p'),
      slug: 'workspace-2b7t9p',
    })

    const result = await checkWorkspaceSlug(ctx, 'workspace-2b7t9p')

    expect(result).toEqual({
      exists: true,
      path: expect.stringContaining(join('.craft-agent', 'workspaces', 'workspace-2b7t9p')),
    })
  })
})
