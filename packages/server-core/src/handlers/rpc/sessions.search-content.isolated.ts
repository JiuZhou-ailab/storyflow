// input: Session content search RPC requests and mocked workspace/session services
// output: Regression coverage for workspace-scoped hidden-session filtering
// pos: Isolated guard preventing content search from scanning all workspace metadata after path-scoped search

import { describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

const searchCalls: Array<{ query: string; sessionsDir: string }> = []

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (idOrName: string) => idOrName === 'Workspace'
    ? { id: 'workspace-1', name: 'Workspace', rootPath: '/workspace-root', slug: 'workspace' }
    : null,
}))

mock.module('@craft-agent/shared/workspaces', () => ({
  getWorkspaceSessionsPath: (rootPath: string) => `${rootPath}/.craft-agent/sessions`,
}))

mock.module('@craft-agent/server-core/services', () => ({
  searchSessions: async (query: string, sessionsDir: string) => {
    searchCalls.push({ query, sessionsDir })
    return [
      { sessionId: 'visible-current', matchCount: 1, matches: [] },
      { sessionId: 'hidden-current', matchCount: 1, matches: [] },
    ]
  },
}))

const { registerSessionsHandlers } = await import('./sessions')

function createSearchHarness() {
  const handlers = new Map<string, HandlerFn>()
  const requestedWorkspaceIds: Array<string | undefined> = []
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
      getSessions: (workspaceId?: string) => {
        requestedWorkspaceIds.push(workspaceId)
        return [
          { id: 'visible-current', hidden: false },
          { id: 'hidden-current', hidden: true },
        ]
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

  registerSessionsHandlers(server, deps)

  const searchContent = handlers.get(RPC_CHANNELS.sessions.SEARCH_CONTENT)
  if (!searchContent) {
    throw new Error('sessions search content handler not registered')
  }

  return { searchContent, requestedWorkspaceIds }
}

describe('sessions search content RPC', () => {
  it('filters hidden sessions with the resolved workspace id', async () => {
    searchCalls.length = 0
    const { searchContent, requestedWorkspaceIds } = createSearchHarness()
    const ctx: RequestContext = {
      clientId: 'client-1',
      workspaceId: null,
      webContentsId: 1,
    }

    const results = await searchContent(ctx, 'Workspace', 'needle', 'search-1') as Array<{ sessionId: string }>

    expect(searchCalls).toEqual([{ query: 'needle', sessionsDir: '/workspace-root/.craft-agent/sessions' }])
    expect(requestedWorkspaceIds).toEqual(['workspace-1'])
    expect(results.map(result => result.sessionId)).toEqual(['visible-current'])
  })
})
