// input: Session list RPC requests with both context and Electron window workspace ids
// output: Regression coverage for using the current window workspace mapping
// pos: Guards in-window workspace switching against stale transport context ids

import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { registerSessionsHandlers } from './sessions'

function createSessionsHarness(windowWorkspaceId: string | undefined) {
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
      waitForInit: async () => {},
      getSessions: (workspaceId?: string) => {
        requestedWorkspaceIds.push(workspaceId)
        return []
      },
    } as unknown as HandlerDeps['sessionManager'],
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
    windowManager: {
      getWorkspaceForWindow: () => windowWorkspaceId,
    } as unknown as HandlerDeps['windowManager'],
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

  const getSessions = handlers.get(RPC_CHANNELS.sessions.GET)
  if (!getSessions) {
    throw new Error('sessions get handler not registered')
  }

  return {
    getSessions,
    requestedWorkspaceIds,
  }
}

describe('sessions get RPC registration', () => {
  it('prefers the current Electron window workspace over a stale context workspace', async () => {
    const { getSessions, requestedWorkspaceIds } = createSessionsHarness('workspace-new')
    const ctx: RequestContext = {
      clientId: 'client-1',
      workspaceId: 'workspace-old',
      webContentsId: 1,
    }

    await getSessions(ctx)

    expect(requestedWorkspaceIds).toEqual(['workspace-new'])
  })
})
