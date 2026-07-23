// input: registerSystemCoreHandlers registration surface
// output: Regression that Whats New / release-notes RPC channels are wired
// pos: Prevents "No handler for: releaseNotes:getWhatsNewManifest" after core/gui split

import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer, HandlerFn } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { CORE_HANDLED_CHANNELS, registerSystemCoreHandlers } from './system'

describe('registerSystemCoreHandlers release notes', () => {
  it('registers get / latestVersion / whatsNewManifest handlers', async () => {
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

    registerSystemCoreHandlers(server, deps)

    expect(CORE_HANDLED_CHANNELS).toContain(RPC_CHANNELS.releaseNotes.GET)
    expect(CORE_HANDLED_CHANNELS).toContain(RPC_CHANNELS.releaseNotes.GET_LATEST_VERSION)
    expect(CORE_HANDLED_CHANNELS).toContain(RPC_CHANNELS.releaseNotes.GET_WHATS_NEW_MANIFEST)

    expect(handlers.has(RPC_CHANNELS.releaseNotes.GET)).toBe(true)
    expect(handlers.has(RPC_CHANNELS.releaseNotes.GET_LATEST_VERSION)).toBe(true)
    expect(handlers.has(RPC_CHANNELS.releaseNotes.GET_WHATS_NEW_MANIFEST)).toBe(true)

    const whatsNew = handlers.get(RPC_CHANNELS.releaseNotes.GET_WHATS_NEW_MANIFEST)!
    const ctx = { clientId: 'c1', workspaceId: null as string | null, webContentsId: null as number | null }
    // Must not throw "No handler"; result may be a manifest object or undefined.
    await expect(whatsNew(ctx)).resolves.toBeTruthy()
  })
})
