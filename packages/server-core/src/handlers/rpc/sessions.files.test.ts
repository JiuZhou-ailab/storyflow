// input: Session file RPC requests against large session directories
// output: Regression coverage for bounded session file tree responses
// pos: Protects the session info file tree from unbounded filesystem scans

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { RPC_CHANNELS, type SessionFile } from '@craft-agent/shared/protocol'
import type { HandlerFn, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { cleanupSessionFileWatchForClient, registerSessionsHandlers } from './sessions'

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
  const events: string[] = []
  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push(channel) { events.push(channel) },
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

  return { getFiles, handlers, events }
}

describe('sessions file tree RPC', () => {
  let tempRoot = ''

  afterEach(() => {
    cleanupSessionFileWatchForClient('client-1')
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = ''
  })

  it('distinguishes missing/corrupt metadata from empty content and reports truncation', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'craft-conversation-limits-'))
    const { getFiles } = createHarness(tempRoot)
    const query = () => getFiles({ clientId: 'client-1', workspaceId: null, webContentsId: null }, 'session-1', 'conversation')
    await expect(query()).rejects.toThrow()
    writeFileSync(join(tempRoot, 'session.jsonl'), JSON.stringify({ id: 'session-1' }) + '\n')
    expect(await query()).toEqual({ groups: [], truncated: false })
    mkdirSync(join(tempRoot, 'work'))
    for (let i = 0; i < 501; i++) writeFileSync(join(tempRoot, 'work', `${i}.txt`), 'test')
    const result = await query()
    expect(result.truncated).toBe(true)
    expect(result.groups[0].files.length).toBe(500)
    writeFileSync(join(tempRoot, 'session.jsonl'), '{invalid')
    await expect(query()).rejects.toThrow()
  })

  it('keeps independent file consumers subscribed and reports persisted attachment changes', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'craft-conversation-watch-'))
    const { handlers, events } = createHarness(tempRoot)
    const ctx = { clientId: 'client-1', workspaceId: null, webContentsId: null }
    const watch = handlers.get(RPC_CHANNELS.sessions.WATCH_FILES)!
    const unwatch = handlers.get(RPC_CHANNELS.sessions.UNWATCH_FILES)!
    await watch(ctx, 'session-1', 'conversation-sidebar')
    await watch(ctx, 'session-1')
    await unwatch(ctx)
    writeFileSync(join(tempRoot, 'session.jsonl'), JSON.stringify({ id: 'session-1' }) + '\n')
    for (let attempt = 0; attempt < 20 && events.length === 0; attempt++) await Bun.sleep(50)
    expect(events).toContain(RPC_CHANNELS.sessions.FILES_CHANGED)
    await unwatch(ctx, 'conversation-sidebar')
    events.length = 0
    writeFileSync(join(tempRoot, 'session.jsonl'), '{}\n')
    await Bun.sleep(650)
    expect(events).toEqual([])
  })

  it('rejects originals outside attachment storage and never scans a substituted work root', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'craft-conversation-boundary-'))
    mkdirSync(join(tempRoot, 'attachments'))
    mkdirSync(join(tempRoot, 'plans'))
    writeFileSync(join(tempRoot, 'plans', 'private.txt'), 'internal')
    symlinkSync(join(tempRoot, 'plans'), join(tempRoot, 'work'))
    const transcript = join(tempRoot, 'session.jsonl')
    writeFileSync(transcript, JSON.stringify({ id: 'session-1' }) + '\n')
    const query = () => createHarness(tempRoot).getFiles({ clientId: 'client-1', workspaceId: null, webContentsId: null }, 'session-1', 'conversation')
    expect(await query()).toEqual({ groups: [], truncated: false })
    writeFileSync(transcript, [
      { id: 'session-1' },
      { type: 'user', attachments: [{ name: '伪装附件', storedPath: join(tempRoot, 'plans/private.txt') }] },
    ].map(value => JSON.stringify(value)).join('\n') + '\n')
    await expect(query()).rejects.toThrow()
  })

  it('lists only conversation work, downloads and sent originals, without following links', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'craft-conversation-files-'))
    for (const directory of ['work', 'downloads', 'attachments', 'plans']) mkdirSync(join(tempRoot, directory))
    for (const file of ['work/report.md', 'work/.cache', 'downloads/chart.png', 'attachments/original.pdf', 'attachments/draft.pdf', 'attachments/converted.md', 'plans/internal.md']) {
      writeFileSync(join(tempRoot, file), file)
    }
    symlinkSync(join(tempRoot, 'plans'), join(tempRoot, 'work', 'outside'))
    const attachment = { name: '材料.pdf', storedPath: join(tempRoot, 'attachments/original.pdf') }
    writeFileSync(join(tempRoot, 'session.jsonl'), [
      { id: 'session-1' },
      { type: 'user', attachments: [attachment, { name: '丢失.pdf', storedPath: join(tempRoot, 'attachments/missing.pdf') }] },
      { type: 'user', attachments: [attachment] },
    ].map(value => JSON.stringify(value)).join('\n') + '\n')
    const before = readFileSync(attachment.storedPath)
    const result = await createHarness(tempRoot).getFiles({ clientId: 'client-1', workspaceId: null, webContentsId: null }, 'session-1', 'conversation')
    expect(result).toMatchObject({
      truncated: false,
      groups: [
        { kind: 'work', files: [{ name: 'report.md' }] },
        { kind: 'downloads', files: [{ name: 'chart.png' }] },
        { kind: 'attachments', files: [{ name: '材料.pdf', readOnly: true }, { name: '丢失.pdf', unavailable: true }] },
      ],
    })
    expect(result.groups.map((group: { files: unknown[] }) => group.files.length)).toEqual([1, 1, 2])
    expect(readFileSync(attachment.storedPath)).toEqual(before)
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
