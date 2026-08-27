// input: Local/headless Project CREATE plus RELINK and SWITCH RPC requests
// output: Regression coverage for canonical registration, stable relinking, root preservation, and runtime activation
// pos: Guards the server boundary between Project storage, active runtimes, and in-memory Sessions

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { FREE_CONVERSATION_WORKSPACE_ID, RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { CONFIG_DIR, ensureConfigDefaults } from '../../../../shared/src/config/storage.ts'
import {
  createWorkspaceAtPath,
  ensureProjectOwnedDirectory,
  isPathWithinProjectRoot,
  isValidWorkspace,
  loadWorkspaceConfig,
  resolveProjectOwnedPath,
} from '@craft-agent/shared/workspaces'
import type { HandlerFn, RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

interface CreatedWorkspace {
  id: string
  name: string
  rootPath: string
  slug: string
  createdAt?: number
  defaultPermissionMode?: 'safe' | 'ask' | 'allow-all'
  defaultEnabledSourceRefs?: string[]
  directoryConfigId?: string
  localMcpEnabled?: boolean
  automationsEnabled?: boolean
  rootAvailable?: boolean
  remoteServer?: {
    url: string
    credentialRef: string
    remoteWorkspaceId: string
  }
}

const createdWorkspaces: CreatedWorkspace[] = []
const registeredProjectCalls: Array<[string, string]> = []
const activeWorkspaceIds: string[] = []
let defaultWorkspacesDir = join(CONFIG_DIR, 'workspaces')

function registerProjectForTest(name: string, rootPath: string): CreatedWorkspace {
  registeredProjectCalls.push([name, rootPath])
  if (!isValidWorkspace(rootPath)) createWorkspaceAtPath(rootPath, name)
  const workspace = {
    id: `workspace-${createdWorkspaces.length + 1}`,
    name,
    rootPath,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'workspace',
  }
  createdWorkspaces.push(workspace)
  return workspace
}

async function connectRemoteForTest(
  workspaceId: string,
  remoteServer: { url: string; token: string; remoteWorkspaceId: string },
) {
  const stored = {
    url: remoteServer.url,
    credentialRef: `remote_server_token::${workspaceId}`,
    remoteWorkspaceId: remoteServer.remoteWorkspaceId,
  }
  const workspace = createdWorkspaces.find(candidate => candidate.id === workspaceId)
  if (workspace) workspace.remoteServer = stored
  return stored
}

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) => createdWorkspaces.find(workspace => workspace.id === id) ?? null,
  getWorkspaces: () => createdWorkspaces,
  setActiveWorkspace: (workspaceId: string) => { activeWorkspaceIds.push(workspaceId) },
  updateWorkspaceRemoteServer: connectRemoteForTest,
}))

mock.module('@craft-agent/shared/workspaces', () => ({
  createWorkspaceAtPath,
  ensureProjectOwnedDirectory,
  ensureDefaultWorkspacesDir: () => { mkdirSync(defaultWorkspacesDir, { recursive: true }) },
  getDefaultWorkspacesDir: () => defaultWorkspacesDir,
  isValidWorkspace,
  isPathWithinProjectRoot,
  loadWorkspaceConfig,
  isWorkspaceRootAvailable: (workspace: CreatedWorkspace) => (
    Boolean(workspace.remoteServer || loadWorkspaceConfig(workspace.rootPath))
  ),
  registerLocalProject: registerProjectForTest,
  relinkWorkspaceRoot: (projectId: string, rootPath: string) => {
    const workspace = createdWorkspaces.find(candidate => candidate.id === projectId)
    if (!workspace) throw new Error('Project not found')
    workspace.rootPath = rootPath
    return { ...workspace, rootAvailable: true }
  },
  resolveRuntimeWorkspace: (workspaceId: string) => workspaceId === FREE_CONVERSATION_WORKSPACE_ID
    ? {
        id: workspaceId,
        name: 'Free',
        slug: 'free',
        rootPath: join(CONFIG_DIR, 'runtime', 'free'),
        createdAt: 0,
      }
    : createdWorkspaces.find(workspace => workspace.id === workspaceId) ?? null,
  resolveProjectOwnedPath,
}))

const { registerWorkspaceCoreHandlers } = await import('./workspace')
const { registerServerHandlers } = await import('./server')

beforeAll(() => {
  mkdirSync(CONFIG_DIR, { recursive: true })
  ensureConfigDefaults()
})

function createWorkspaceHarness() {
  const handlers = new Map<string, HandlerFn>()
  let reloadSessionsCount = 0
  const reloadSessionScopes: Array<string | undefined> = []
  const setupConfigWatcherCalls: Array<[string, string]> = []
  const rebindWorkspaceRootCalls: Array<[string, string]> = []
  const projectLifecycleCalls: string[] = []
  let projectLifecycleWorkspaceOverride: CreatedWorkspace | undefined

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
      registerProject: async (name: string, rootPath: string, remoteServer?: {
        url: string
        token: string
        remoteWorkspaceId: string
      }) => {
        const workspace = registerProjectForTest(name, rootPath)
        if (remoteServer) workspace.remoteServer = await connectRemoteForTest(workspace.id, remoteServer)
        reloadSessionsCount += 1
        reloadSessionScopes.push(workspace.id)
        setupConfigWatcherCalls.push([workspace.rootPath, workspace.id])
        activeWorkspaceIds.push(workspace.id)
        return workspace
      },
      activateProject: async (workspaceId: string) => {
        const workspace = workspaceId === FREE_CONVERSATION_WORKSPACE_ID
          ? {
              id: workspaceId,
              name: 'Free',
              slug: 'free',
              rootPath: join(CONFIG_DIR, 'runtime', 'free'),
            }
          : createdWorkspaces.find(candidate => candidate.id === workspaceId)
        if (!workspace) throw new Error(`Project not found: ${workspaceId}`)
        setupConfigWatcherCalls.push([workspace.rootPath, workspace.id])
        return workspace
      },
      updateRemoteProject: async (workspaceId: string, remoteServer: {
        url: string
        token: string
        remoteWorkspaceId: string
      }) => { await connectRemoteForTest(workspaceId, remoteServer) },
      reloadSessions: async (workspaceId?: string) => {
        reloadSessionsCount += 1
        reloadSessionScopes.push(workspaceId)
      },
      rebindWorkspaceRoot: async (projectId: string, currentRoot: string) => {
        rebindWorkspaceRootCalls.push([projectId, currentRoot])
        const workspace = createdWorkspaces.find(candidate => candidate.id === projectId)!
        workspace.rootPath = currentRoot
        return workspace
      },
      getActiveSessionCount: () => 0,
      getSessions: () => [],
      withProjectLifecycle: async <T>(projectId: string, work: (workspace: CreatedWorkspace) => Promise<T>) => {
        projectLifecycleCalls.push(projectId)
        const workspace = projectLifecycleWorkspaceOverride?.id === projectId
          ? projectLifecycleWorkspaceOverride
          : createdWorkspaces.find(candidate => candidate.id === projectId)
        if (!workspace) throw new Error(`Project not found: ${projectId}`)
        return work(workspace)
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
  const relinkWorkspace = handlers.get(RPC_CHANNELS.workspaces.RELINK)
  if (!relinkWorkspace) {
    throw new Error('workspace relink handler not registered')
  }
  const writeWorkspaceImage = handlers.get(RPC_CHANNELS.workspace.WRITE_IMAGE)
  if (!writeWorkspaceImage) {
    throw new Error('workspace image handler not registered')
  }
  const readWorkspaceImage = handlers.get(RPC_CHANNELS.workspace.READ_IMAGE)
  if (!readWorkspaceImage) throw new Error('workspace image read handler not registered')
  const listViews = handlers.get(RPC_CHANNELS.views.LIST)
  if (!listViews) throw new Error('views list handler not registered')
  const saveViews = handlers.get(RPC_CHANNELS.views.SAVE)
  if (!saveViews) throw new Error('views save handler not registered')
  const getWorkspaceTheme = handlers.get(RPC_CHANNELS.theme.GET_WORKSPACE_COLOR_THEME)
  const setWorkspaceTheme = handlers.get(RPC_CHANNELS.theme.SET_WORKSPACE_COLOR_THEME)
  const getAllWorkspaceThemes = handlers.get(RPC_CHANNELS.theme.GET_ALL_WORKSPACE_THEMES)
  if (!getWorkspaceTheme || !setWorkspaceTheme || !getAllWorkspaceThemes) {
    throw new Error('workspace theme handlers not registered')
  }

  const ctx: RequestContext = {
    clientId: 'client-1',
    workspaceId: null,
    webContentsId: 1,
  }

  return {
    createWorkspace,
    relinkWorkspace,
    writeWorkspaceImage,
    readWorkspaceImage,
    listViews,
    saveViews,
    getWorkspaceTheme,
    setWorkspaceTheme,
    getAllWorkspaceThemes,
    checkWorkspaceSlug,
    switchWorkspace,
    ctx,
    getReloadSessionsCount: () => reloadSessionsCount,
    getReloadSessionScopes: () => reloadSessionScopes,
    getSetupConfigWatcherCalls: () => setupConfigWatcherCalls,
    getRebindWorkspaceRootCalls: () => rebindWorkspaceRootCalls,
    getProjectLifecycleCalls: () => projectLifecycleCalls,
    setProjectLifecycleWorkspace: (workspace: CreatedWorkspace) => {
      projectLifecycleWorkspaceOverride = workspace
    },
  }
}

function createServerWorkspaceHarness() {
  const handlers = new Map<string, HandlerFn>()
  const waitForInitScopes: Array<string | null | undefined> = []
  const reloadSessionScopes: Array<string | undefined> = []
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
      waitForInit: async (workspaceId?: string | null) => { waitForInitScopes.push(workspaceId) },
      registerProject: async (name: string, rootPath: string) => {
        const workspace = registerProjectForTest(name, rootPath)
        Object.assign(workspace, {
          createdAt: 1,
          defaultPermissionMode: 'allow-all' as const,
          defaultEnabledSourceRefs: ['workspace:private:identity'],
          directoryConfigId: 'directory-private',
          localMcpEnabled: true,
          automationsEnabled: true,
          rootAvailable: true,
        })
        reloadSessionScopes.push(workspace.id)
        setupConfigWatcherCalls.push([workspace.rootPath, workspace.id])
        activeWorkspaceIds.push(workspace.id)
        return workspace
      },
      reloadSessions: async (workspaceId?: string) => { reloadSessionScopes.push(workspaceId) },
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

  registerServerHandlers(server, deps, {
    getConnectedClientCount: () => 0,
    serverId: 'server-test',
    startedAt: Date.now(),
  })

  const createWorkspace = handlers.get(RPC_CHANNELS.server.CREATE_WORKSPACE)
  if (!createWorkspace) throw new Error('server workspace create handler not registered')

  return {
    createWorkspace,
    waitForInitScopes,
    reloadSessionScopes,
    setupConfigWatcherCalls,
  }
}

describe('workspace core RPC registration', () => {
  it('reads and writes workspace themes only at the lifecycle-committed root', async () => {
    createdWorkspaces.length = 0
    const staleRoot = mkdtempSync(join(tmpdir(), 'craft-theme-stale-root-'))
    const currentRoot = mkdtempSync(join(tmpdir(), 'craft-theme-current-root-'))
    createWorkspaceAtPath(staleRoot, 'Theme Project')
    createWorkspaceAtPath(currentRoot, 'Theme Project')
    const workspace = {
      id: 'workspace-theme-project',
      name: 'Theme Project',
      rootPath: staleRoot,
      slug: 'theme-project',
    }
    createdWorkspaces.push(workspace)
    const {
      ctx,
      getWorkspaceTheme,
      setWorkspaceTheme,
      getAllWorkspaceThemes,
      setProjectLifecycleWorkspace,
    } = createWorkspaceHarness()
    setProjectLifecycleWorkspace({ ...workspace, rootPath: currentRoot })

    try {
      await setWorkspaceTheme(ctx, workspace.id, 'nord')
      expect(await getWorkspaceTheme(ctx, workspace.id)).toBe('nord')
      expect(await getAllWorkspaceThemes(ctx)).toEqual({ [workspace.id]: 'nord' })
      expect(loadWorkspaceConfig(staleRoot)?.defaults?.colorTheme).toBeUndefined()
      expect(loadWorkspaceConfig(currentRoot)?.defaults?.colorTheme).toBe('nord')
    } finally {
      rmSync(staleRoot, { recursive: true, force: true })
      rmSync(currentRoot, { recursive: true, force: true })
      createdWorkspaces.length = 0
    }
  })

  it('rejects final, ancestor, and broken symlinks when reading a workspace image', async () => {
    createdWorkspaces.length = 0
    const projectRoot = mkdtempSync(join(tmpdir(), 'craft-workspace-image-project-'))
    const outsideRoot = mkdtempSync(join(tmpdir(), 'craft-workspace-image-outside-'))
    const outsideSecret = join(outsideRoot, 'secret.txt')
    writeFileSync(outsideSecret, 'outside secret')
    symlinkSync(outsideSecret, join(projectRoot, 'final.svg'))
    symlinkSync(outsideRoot, join(projectRoot, 'assets'), 'dir')
    symlinkSync(join(outsideRoot, 'missing.txt'), join(projectRoot, 'broken.svg'))
    createdWorkspaces.push({
      id: 'workspace-image-project',
      name: 'Image Project',
      rootPath: projectRoot,
      slug: 'image-project',
    })
    const { readWorkspaceImage, ctx, getProjectLifecycleCalls } = createWorkspaceHarness()

    try {
      for (const relativePath of ['final.svg', 'assets/secret.svg', 'broken.svg']) {
        await expect(readWorkspaceImage(ctx, 'workspace-image-project', relativePath))
          .rejects.toThrow(/symbolic link/)
      }
      expect(getProjectLifecycleCalls()).toEqual([
        'workspace-image-project',
        'workspace-image-project',
        'workspace-image-project',
      ])
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(outsideRoot, { recursive: true, force: true })
    }
  })

  it('rejects a workspace image write through a project-internal symlink', async () => {
    createdWorkspaces.length = 0
    const projectRoot = mkdtempSync(join(tmpdir(), 'craft-workspace-image-project-'))
    const outsideRoot = mkdtempSync(join(tmpdir(), 'craft-workspace-image-outside-'))
    const outsideIcon = join(outsideRoot, 'icon.svg')
    writeFileSync(outsideIcon, '<svg>keep</svg>')
    symlinkSync(outsideRoot, join(projectRoot, 'assets'), 'dir')
    createdWorkspaces.push({
      id: 'workspace-image-project',
      name: 'Image Project',
      rootPath: projectRoot,
      slug: 'image-project',
    })
    const { writeWorkspaceImage, ctx, getProjectLifecycleCalls } = createWorkspaceHarness()

    try {
      await expect(writeWorkspaceImage(
        ctx,
        'workspace-image-project',
        'assets/icon.svg',
        Buffer.from('<svg>replace</svg>').toString('base64'),
        'image/svg+xml',
      )).rejects.toThrow(/symbolic link/)
      expect(readFileSync(outsideIcon, 'utf-8')).toBe('<svg>keep</svg>')
      expect(getProjectLifecycleCalls()).toEqual(['workspace-image-project'])
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(outsideRoot, { recursive: true, force: true })
    }
  })

  it('seeds and saves views only at the lifecycle-committed Project root', async () => {
    createdWorkspaces.length = 0
    const staleRoot = mkdtempSync(join(tmpdir(), 'craft-views-stale-root-'))
    const listRoot = mkdtempSync(join(tmpdir(), 'craft-views-list-root-'))
    const saveRoot = mkdtempSync(join(tmpdir(), 'craft-views-save-root-'))
    const workspace = {
      id: 'workspace-views-project',
      name: 'Views Project',
      rootPath: staleRoot,
      slug: 'views-project',
    }
    createdWorkspaces.push(workspace)
    const {
      listViews,
      saveViews,
      ctx,
      getProjectLifecycleCalls,
      setProjectLifecycleWorkspace,
    } = createWorkspaceHarness()

    try {
      setProjectLifecycleWorkspace({ ...workspace, rootPath: listRoot })
      await listViews(ctx, workspace.id)
      expect(existsSync(join(listRoot, '.craft-agent', 'views.json'))).toBe(true)
      expect(existsSync(join(staleRoot, '.craft-agent', 'views.json'))).toBe(false)

      setProjectLifecycleWorkspace({ ...workspace, rootPath: saveRoot })
      await saveViews(ctx, workspace.id, [{
        id: 'view-review',
        name: 'Review',
        expression: 'status == "review"',
      }])
      expect(existsSync(join(saveRoot, '.craft-agent', 'views.json'))).toBe(true)
      expect(existsSync(join(staleRoot, '.craft-agent', 'views.json'))).toBe(false)
      expect(getProjectLifecycleCalls()).toEqual([
        'workspace-views-project',
        'workspace-views-project',
      ])
    } finally {
      rmSync(staleRoot, { recursive: true, force: true })
      rmSync(listRoot, { recursive: true, force: true })
      rmSync(saveRoot, { recursive: true, force: true })
    }
  })


  it('routes headless Project creation through canonical registration and activation', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'craft-server-workspace-create-handler-'))
    defaultWorkspacesDir = join(parent, 'managed-projects')
    createdWorkspaces.length = 0
    registeredProjectCalls.length = 0
    activeWorkspaceIds.length = 0
    const {
      createWorkspace,
      waitForInitScopes,
      reloadSessionScopes,
      setupConfigWatcherCalls,
    } = createServerWorkspaceHarness()

    try {
      const workspace = await createWorkspace({
        clientId: 'client-1',
        workspaceId: null,
        webContentsId: null,
      }, 'Headless Project') as CreatedWorkspace
      const rootPath = join(defaultWorkspacesDir, 'headless-project')

      expect(registeredProjectCalls).toEqual([['Headless Project', rootPath]])
      expect(waitForInitScopes).toEqual([undefined])
      expect(reloadSessionScopes).toEqual([workspace.id])
      expect(setupConfigWatcherCalls).toEqual([[rootPath, workspace.id]])
      expect(activeWorkspaceIds).toEqual([workspace.id])
      expect(loadWorkspaceConfig(rootPath)?.name).toBe('Headless Project')
      expect(Object.keys(workspace).sort()).toEqual(['id', 'name', 'slug'])
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('relinks the same Project identity to an explicitly selected existing directory', async () => {
    createdWorkspaces.length = 0
    const parent = mkdtempSync(join(tmpdir(), 'craft-workspace-relink-handler-'))
    const missingRoot = join(parent, 'moved-from')
    const currentRoot = join(parent, 'moved-to')
    createWorkspaceAtPath(currentRoot, 'Moved Project')
    createdWorkspaces.push({
      id: 'project-stable',
      name: 'Moved Project',
      rootPath: missingRoot,
      slug: 'moved-project',
    })
    const { relinkWorkspace, ctx, getRebindWorkspaceRootCalls } = createWorkspaceHarness()

    try {
      const workspace = await relinkWorkspace(ctx, 'project-stable', currentRoot) as CreatedWorkspace

      expect(workspace.id).toBe('project-stable')
      expect(workspace.rootPath).toBe(currentRoot)
      expect(getRebindWorkspaceRootCalls()).toEqual([['project-stable', currentRoot]])
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

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
    const {
      createWorkspace,
      ctx,
      getReloadSessionsCount,
      getReloadSessionScopes,
      getSetupConfigWatcherCalls,
    } = createWorkspaceHarness()

    try {
      await createWorkspace(
        ctx,
        rootPath,
        'Book',
        { projectType: 'novel', methodPackId: 'novel.claude-book' },
        'novel',
      )

      expect(getReloadSessionsCount()).toBe(1)
      expect(getReloadSessionScopes()).toEqual(['workspace-1'])
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

  it('preserves an untracked existing workspace folder in the default directory', async () => {
    createdWorkspaces.length = 0
    const slug = `craft-stale-default-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const rootPath = join(homedir(), '.craft-agent', 'workspaces', slug)
    rmSync(rootPath, { recursive: true, force: true })
    createWorkspaceAtPath(rootPath, 'Old Project')
    writeFileSync(join(rootPath, 'keep.md'), '# Keep\n')
    const { createWorkspace, ctx } = createWorkspaceHarness()

    try {
      await createWorkspace(ctx, rootPath, 'Book', { projectType: 'novel', methodPackId: 'novel.claude-book' })

      expect(loadWorkspaceConfig(rootPath)?.name).toBe('Old Project')
      expect(existsSync(join(rootPath, '.craft-agent', 'config.json'))).toBe(true)
      expect(existsSync(join(rootPath, 'keep.md'))).toBe(true)
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
