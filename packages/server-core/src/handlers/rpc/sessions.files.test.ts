// input: Session file RPC requests against large session directories
// output: Regression coverage for bounded session file tree responses
// pos: Protects the session info file tree from unbounded filesystem scans

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { RPC_CHANNELS, type SessionFile } from '@craft-agent/shared/protocol'
import type { HandlerFn, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { registerSessionsHandlers } from './sessions'

function countSessionFiles(files: SessionFile[]): number {
  let count = 0
  for (const file of files) {
    count += 1
    if (file.children) count += countSessionFiles(file.children)
  }
  return count
}

function createHarness(sessionPath: string) {
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
    sessionManager: {
      getSessionPath: (sessionId: string) => sessionId === 'session-1' ? sessionPath : null,
      withSessionPathOperation: async <T>(
        sessionId: string,
        work: (sessionPath: string) => Promise<T> | T,
      ): Promise<T> => {
        if (sessionId !== 'session-1') throw new Error('Session not found')
        return work(sessionPath)
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

  const getFiles = handlers.get(RPC_CHANNELS.sessions.GET_FILES)
  if (!getFiles) throw new Error('sessions get files handler not registered')

  return { getFiles }
}

describe('sessions file tree RPC', () => {
  let tempRoot = ''

  afterEach(() => {
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = ''
  })

  it('caps large session directories before returning them to the renderer', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'craft-session-files-'))
    for (let i = 0; i < 550; i += 1) {
      writeFileSync(join(tempRoot, `file-${String(i).padStart(3, '0')}.txt`), 'x')
    }

    const { getFiles } = createHarness(tempRoot)
    const files = await getFiles({ clientId: 'client-1', workspaceId: null, webContentsId: null }, 'session-1') as SessionFile[]

    expect(countSessionFiles(files)).toBe(500)
    expect(files[0]?.name).toBe('file-000.txt')
    expect(files.at(-1)?.name).toBe('file-499.txt')
  })
})
