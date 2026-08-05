// input: Workspace CREATE and SWITCH RPC requests
// output: Regression coverage for blank roots, remote options, stale default reuse, and runtime activation
// pos: Guards the server boundary between workspace storage, active runtimes, and in-memory sessions

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { FREE_CONVERSATION_WORKSPACE_ID, RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { CONFIG_DIR, ensureConfigDefaults } from '../../../../shared/src/config/storage.ts'
import {
  createWorkspaceAtPath,
  isValidWorkspace,
  loadWorkspaceConfig,
} from '@craft-agent/shared/workspaces'
import type { HandlerFn, RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

interface CreatedWorkspace {
  id: string
  name: string
  rootPath: string
  slug: string
  remoteServer?: {
    url: string
    credentialRef: string
    remoteWorkspaceId: string
  }
}

const createdWorkspaces: CreatedWorkspace[] = []

mock.module('@craft-agent/shared/config', () => ({
  addWorkspace: ({
    name,
    rootPath,
    remoteServer,
  }: Pick<CreatedWorkspace, 'name' | 'rootPath' | 'remoteServer'>) => {
    if (!isValidWorkspace(rootPath)) {
      createWorkspaceAtPath(rootPath, name)
    }
    const workspace = {
      id: `workspace-${createdWorkspaces.length + 1}`,
      name,
      rootPath,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'workspace',
      ...(remoteServer && { remoteServer }),
    }
    createdWorkspaces.push(workspace)
    return workspace
  },
  getWorkspaceByNameOrId: (id: string) => createdWorkspaces.find(workspace => workspace.id === id) ?? null,
  getWorkspaces: () => createdWorkspaces,
  setActiveWorkspace: () => {},
  updateWorkspaceRemoteServer: async (
    workspaceId: string,
    remoteServer: { url: string; token: string; remoteWorkspaceId: string },
  ) => {
    const stored = {
      url: remoteServer.url,
      credentialRef: `remote_server_token::${workspaceId}`,
      remoteWorkspaceId: remoteServer.remoteWorkspaceId,
    }
    const workspace = createdWorkspaces.find(candidate => candidate.id === workspaceId)
    if (workspace) workspace.remoteServer = stored
    return stored
  },
}))

const { registerWorkspaceCoreHandlers } = await import('./workspace')

beforeAll(() => {
  mkdirSync(CONFIG_DIR, { recursive: true })
  ensureConfigDefaults()
})

function createWorkspaceHarness() {
  const handlers = new Map<string, HandlerFn>()
  let reloadSessionsCount = 0
  const setupConfigWatcherCalls: Array<[string, string]> = []

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
      waitForInit: async () => {},
      reloadSessions: () => {
        reloadSessionsCount += 1
      },
      setupConfigWatcher: (rootPath: string, workspaceId: string) => {
        setupConfigWatcherCalls.push([rootPath, workspaceId])
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
  const switchWorkspace = handlers.get(RPC_CHANNELS.window.SWITCH_WORKSPACE)
  if (!switchWorkspace) {
    throw new Error('workspace switch handler not registered')
  }

  const ctx: RequestContext = {
    clientId: 'client-1',
    workspaceId: null,
    webContentsId: 1,
  }

  return {
    createWorkspace,
    checkWorkspaceSlug,
    switchWorkspace,
    ctx,
    getReloadSessionsCount: () => reloadSessionsCount,
    getSetupConfigWatcherCalls: () => setupConfigWatcherCalls,
  }
}

describe('workspace core RPC registration', () => {
  it('activates the config watcher when switching to the Free Conversation runtime', async () => {
    createdWorkspaces.length = 0
    const { switchWorkspace, ctx, getSetupConfigWatcherCalls } = createWorkspaceHarness()

    await switchWorkspace(ctx, FREE_CONVERSATION_WORKSPACE_ID)

    expect(getSetupConfigWatcherCalls()).toEqual([[
      join(CONFIG_DIR, 'runtime', 'free'),
      FREE_CONVERSATION_WORKSPACE_ID,
    ]])
  })

  it('creates a blank workspace while tolerating legacy method fields', async () => {
    createdWorkspaces.length = 0
    const rootPath = mkdtempSync(join(tmpdir(), 'craft-workspace-create-handler-'))
    const { createWorkspace, ctx, getReloadSessionsCount, getSetupConfigWatcherCalls } = createWorkspaceHarness()

    try {
      await createWorkspace(
        ctx,
        rootPath,
        'Book',
        { projectType: 'novel', methodPackId: 'novel.claude-book' },
        'novel',
      )

      expect(getReloadSessionsCount()).toBe(1)
      expect(getSetupConfigWatcherCalls()).toEqual([[rootPath, 'workspace-1']])
      expect(loadWorkspaceConfig(rootPath)?.defaults?.workingDirectory).toBe(rootPath)
      expect(readdirSync(rootPath).filter(entry => !entry.startsWith('.'))).toEqual([])
      expect(existsSync(join(rootPath, '.git'))).toBe(false)
      expect(existsSync(join(rootPath, '.craft-agent', 'craft-writing.json'))).toBe(false)
      expect(existsSync(join(rootPath, '.craft-agent', 'craft-pack-lock.json'))).toBe(false)
    } finally {
      rmSync(rootPath, { recursive: true, force: true })
    }
  })

  it('preserves a legacy direct remote server argument while ignoring the fourth argument', async () => {
    createdWorkspaces.length = 0
    const rootPath = mkdtempSync(join(tmpdir(), 'craft-remote-workspace-create-handler-'))
    const { createWorkspace, ctx } = createWorkspaceHarness()
    const remoteServer = {
      url: 'ws://localhost:9100',
      token: 'token',
      remoteWorkspaceId: 'remote-ws',
    }

    try {
      const workspace = await createWorkspace(ctx, rootPath, 'Remote', remoteServer, 'novel')

      expect(workspace.remoteServer).toEqual({
        url: remoteServer.url,
        credentialRef: `remote_server_token::${workspace.id}`,
        remoteWorkspaceId: remoteServer.remoteWorkspaceId,
      })
      expect(JSON.stringify(workspace)).not.toContain('"token":')
      expect(readdirSync(rootPath).filter(entry => !entry.startsWith('.'))).toEqual([])
    } finally {
      rmSync(rootPath, { recursive: true, force: true })
    }
  })

  it('reinitializes an untracked stale default workspace folder as a blank workspace', async () => {
    createdWorkspaces.length = 0
    const slug = `craft-stale-default-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const rootPath = join(homedir(), '.craft-agent', 'workspaces', slug)
    rmSync(rootPath, { recursive: true, force: true })
    createWorkspaceAtPath(rootPath, 'Old Project')
    const { createWorkspace, ctx } = createWorkspaceHarness()

    try {
      await createWorkspace(ctx, rootPath, 'Book', { projectType: 'novel', methodPackId: 'novel.claude-book' })

      expect(loadWorkspaceConfig(rootPath)?.name).toBe('Book')
      expect(readdirSync(rootPath).filter(entry => !entry.startsWith('.'))).toEqual([])
      expect(existsSync(join(rootPath, '.craft-agent', 'craft-writing.json'))).toBe(false)
      expect(existsSync(join(rootPath, '.craft-agent', 'craft-pack-lock.json'))).toBe(false)
    } finally {
      rmSync(rootPath, { recursive: true, force: true })
    }
  })

  it('does not reinitialize an existing custom workspace folder when creating at an explicit path', async () => {
    createdWorkspaces.length = 0
    const rootPath = mkdtempSync(join(tmpdir(), 'craft-custom-stale-workspace-'))
    createWorkspaceAtPath(rootPath, 'Old Project')
    writeFileSync(join(rootPath, 'keep.md'), '# Keep\n')
    const { createWorkspace, ctx } = createWorkspaceHarness()

    try {
      await createWorkspace(ctx, rootPath, 'Book', { projectType: 'novel', methodPackId: 'novel.claude-book' })

      expect(existsSync(join(rootPath, '.craft-agent', 'config.json'))).toBe(true)
      expect(existsSync(join(rootPath, 'keep.md'))).toBe(true)
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
