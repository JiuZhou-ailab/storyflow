// input: Domain IPC registrars with a mocked ipcMain
// output: Channel inventory and input-coercion coverage after the move out of index.ts
// pos: Guards the shell, auth, market, feedback, and Host IPC boundaries

import { describe, expect, it, mock } from 'bun:test'
import type { ClientAuthService } from '../../client-auth'
import type { SessionManager } from '@craft-agent/server-core/sessions'
import { CLIENT_AUTH_IPC_CHANNELS, MCP_MARKET_IPC_CHANNELS, SKILLS_MARKET_IPC_CHANNELS } from '../../../shared/types'

const channels: string[] = []
const handlers = new Map<string, (...args: unknown[]) => unknown>()

mock.module('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      channels.push(channel)
      handlers.set(channel, handler)
    },
    on: (channel: string, handler: (...args: unknown[]) => unknown) => {
      channels.push(channel)
      handlers.set(channel, handler)
    },
  },
  app: { relaunch() {}, quit() {} },
  BrowserWindow: {
    fromWebContents: () => null,
    getFocusedWindow: () => null,
    getAllWindows: () => [],
  },
  dialog: { showMessageBox: async () => ({ response: 0 }) },
}))

const { registerShellIpc } = await import('../shell-ipc')
const { registerClientAuthIpc } = await import('../client-auth-ipc')
const { registerMarketIpc } = await import('../market-ipc')
const { registerFeedbackIpc } = await import('../feedback-ipc')
const { registerHostIpc } = await import('../host-ipc')

describe('domain IPC registration', () => {
  it('registers the same channels index.ts used to register', async () => {
    const log = { info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) }
    const signIn = mock(async (input: unknown) => input)
    registerShellIpc({ windowManager: null, log })
    registerClientAuthIpc({ signIn } as unknown as ClientAuthService)
    registerMarketIpc({
      catalog: { load: async () => [], invalidate() {} },
      authService: { getState: () => ({ user: null }) } as unknown as ClientAuthService,
      getToken: async () => undefined,
      fetchImpl: async () => new Response(),
    })
    registerFeedbackIpc({ fetch: async () => new Response() })
    registerHostIpc({
      sessionManager: {} as SessionManager,
      getWorkspaceId: () => null,
      endpoint: () => ({ url: 'ws://127.0.0.1:1' }),
      token: 'token',
    })

    expect(channels).toEqual([
      '__get-web-contents-id',
      '__get-workspace-id',
      '__transport:status',
      '__renderer:crash',
      '__dialog:showMessageBox',
      CLIENT_AUTH_IPC_CHANNELS.GET_STATE,
      CLIENT_AUTH_IPC_CHANNELS.SIGN_IN,
      CLIENT_AUTH_IPC_CHANNELS.SIGN_UP,
      CLIENT_AUTH_IPC_CHANNELS.VERIFY_EMAIL,
      CLIENT_AUTH_IPC_CHANNELS.RESEND_VERIFICATION_EMAIL,
      CLIENT_AUTH_IPC_CHANNELS.SIGN_IN_WITH_FEISHU,
      CLIENT_AUTH_IPC_CHANNELS.CANCEL_FEISHU_SIGN_IN,
      CLIENT_AUTH_IPC_CHANNELS.SIGN_OUT,
      SKILLS_MARKET_IPC_CHANNELS.LIST,
      SKILLS_MARKET_IPC_CHANNELS.DETAIL,
      SKILLS_MARKET_IPC_CHANNELS.DOWNLOAD,
      SKILLS_MARKET_IPC_CHANNELS.PUBLISH,
      MCP_MARKET_IPC_CHANNELS.LIST,
      'feedback:submitIssue',
      'workspace:setArchived',
      'workspace:remove',
      'server:invokeOnServer',
      'session:transferToRemoteWorkspace',
      'app:relaunch',
      'i18n:changeLanguage',
      '__get-ws-endpoint',
      '__get-ws-token',
      '__get-workspace-remote-config',
      '__get-remote-server-token',
    ])

    handlers.get('__transport:status')!({}, { level: 'error', message: 'socket closed', status: 'closed' })
    expect(log.error).toHaveBeenCalledWith('socket closed', expect.objectContaining({ status: 'closed' }))

    await handlers.get(CLIENT_AUTH_IPC_CHANNELS.SIGN_IN)!({}, { identifier: 'ada' })
    expect(signIn).toHaveBeenCalledWith({ identifier: 'ada', password: '' })
  })
})
