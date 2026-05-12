// input: Workspace create RPC registration with Method Pack scaffolding
// output: Regression coverage for hydrating starter sessions after workspace creation
// pos: Guards the server-side boundary between workspace scaffolding and in-memory sessions

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
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
    },
  }

  registerWorkspaceCoreHandlers(server, deps)

  const createWorkspace = handlers.get(RPC_CHANNELS.workspaces.CREATE)
  if (!createWorkspace) {
    throw new Error('workspace create handler not registered')
  }

  const ctx: RequestContext = {
    clientId: 'client-1',
    workspaceId: null,
    webContentsId: 1,
  }

  return {
    createWorkspace,
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
})
