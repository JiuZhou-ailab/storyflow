// input: SessionManager persistence, transient context, performance hooks, and Pi runtime lifecycle
// output: Regression coverage for durable messages, compatible leases, exclusive mutations, and deletion tombstones
// pos: Guards send acceptance and runtime ownership across concurrent session operations

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import type { StoredAttachment } from '@craft-agent/core/types'
import type { FileAttachment, SendMessageOptions } from '@craft-agent/shared/protocol'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getSessionFilePath, sessionPersistenceQueue } from '@craft-agent/shared/sessions/storage'
import { clearMetrics, configurePerfTracking } from '@craft-agent/shared/utils'
import type { HandlerFn, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handlers/handler-deps'
import { registerSessionsHandlers } from '../handlers/rpc/sessions'
import { SessionManager, createManagedSession } from './SessionManager.ts'

interface CapturedPerfMetric {
  name: string
  marks: Array<{ name: string }>
  metadata?: Record<string, unknown>
}

// Regression test for the High-severity finding in eb81086e:
//
//   sendMessage's `{ accepted, messageId }` ack contract was returning before
//   the user message hit disk because `persistSession` only enqueues with a
//   500ms debounce. A crash inside the debounce window after ack would lose
//   the message.
//
// The fix added `await this.flushSession(managed.id)` between persistSession
// and onAck. This test locks that ordering by reading the session file from
// inside the onAck callback and asserting the user message is already there.

describe('sendMessage durability', () => {
  let tmpRoot: string
  let sm: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-durability-'))
    mkdirSync(join(tmpRoot, '.craft-agent'))
    writeFileSync(join(tmpRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'directory-test', name: 'Test Workspace', slug: 'test-workspace', createdAt: 1, updatedAt: 1,
    }))
    sm = new SessionManager((_workspaceId, managed) => managed.workspace)
    clearMetrics()
  })

  afterEach(async () => {
    const sessionIds = (sm as unknown as { sessions: Map<string, unknown> }).sessions.keys()
    for (const sessionId of sessionIds) await sm.flushSession(sessionId)
    sm.cleanup()
    configurePerfTracking({ enabled: false, onMetric: undefined })
    clearMetrics()
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function capturePerfMetrics(): CapturedPerfMetric[] {
    const metrics: CapturedPerfMetric[] = []
    configurePerfTracking({
      enabled: true,
      onMetric: metric => {
        metrics.push(metric)
      },
    })
    return metrics
  }

  function buildSession(id: string) {
    const workspace = {
      id: 'ws_test',
      name: 'Test Workspace',
      rootPath: realpathSync(tmpRoot),
      directoryConfigId: 'directory-test',
      createdAt: Date.now(),
    }
    const managed = createManagedSession(
      { id, name: 'durability test' },
      workspace as never,
      { messagesLoaded: true },
    )
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    return managed
  }

  function readPersistedMessageIds(sessionId: string): string[] {
    const path = getSessionFilePath(tmpRoot, sessionId)
    if (!existsSync(path)) return []
    const lines = readFileSync(path, 'utf-8').trim().split('\n')
    // First line is the header, remaining lines are messages.
    return lines.slice(1).map(l => JSON.parse(l)).map(m => m.id as string)
  }

  function readPersistedTitle(sessionId: string): string | undefined {
    const path = getSessionFilePath(tmpRoot, sessionId)
    if (!existsSync(path)) return undefined
    const [header] = readFileSync(path, 'utf-8').trim().split('\n')
    return JSON.parse(header).name as string | undefined
  }

  function blockFirstChat() {
    const entered = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    const chats: string[] = []
    const inputs: Array<{ attachments?: FileAttachment[]; oneTimeContext?: string }> = []
    ;(sm as any).getOrCreateAgentLocked = async () => ({
      getModel: () => 'test-model', setAllSources() {}, getSessionId: () => undefined, dispose() {},
      async *chat(message: string, attachments?: FileAttachment[], options?: SendMessageOptions) {
        chats.push(message)
        inputs.push({ attachments, oneTimeContext: options?.oneTimeContext })
        if (chats.length === 1) {
          entered.resolve()
          await resume.promise
        }
        yield { type: 'text_complete', text: `reply:${message}` }
        yield { type: 'complete' }
      },
    })
    return { entered: entered.promise, resume: resume.resolve, chats, inputs }
  }

  function injectDiskFull(shouldFail: (data: string) => boolean | Promise<boolean>) {
    // Fault the atomic writer's temp-file I/O, keeping the real write queue and rollback path.
    return spyOn(sessionPersistenceQueue as unknown as {
      writeFile: (path: string, data: string, encoding: BufferEncoding) => Promise<void>
    }, 'writeFile')
      .mockImplementation(async (path, data, encoding) => {
        if (await shouldFail(data)) throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
        await writeFile(path, data, encoding)
      })
  }

  function rpcHandlers() {
    const handlers = new Map<string, HandlerFn>()
    const server: RpcServer = {
      handle: (channel, handler) => { handlers.set(channel, handler) },
      push() {},
      async invokeClient() { return undefined },
    }
    registerSessionsHandlers(server, {
      sessionManager: sm,
      oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
      platform: { logger: { error() {} } } as HandlerDeps['platform'],
    })
    return handlers
  }

  const rpcContext = { clientId: 'durability-test-client', workspaceId: 'ws_test', webContentsId: 1 }

  function sendViaRpc(
    sessionId: string,
    content: string,
    options?: SendMessageOptions,
    attachments?: FileAttachment[],
    storedAttachments?: StoredAttachment[],
  ) {
    return rpcHandlers().get(RPC_CHANNELS.sessions.SEND_MESSAGE)!(
      rpcContext,
      sessionId, content, attachments, storedAttachments, options,
    )
  }

  function findAcceptMetric(metrics: CapturedPerfMetric[], status: string): CapturedPerfMetric | undefined {
    return metrics.find(metric =>
      metric.name === 'session.sendMessage.accept'
      && metric.metadata?.status === status
    )
  }

  function expectAcceptMetric(metric: CapturedPerfMetric | undefined, status: string) {
    expect(metric).toBeDefined()
    if (!metric) throw new Error('missing session.sendMessage.accept metric')

    expect(metric.name).toBe('session.sendMessage.accept')
    expect(metric.metadata).toEqual(expect.objectContaining({ status }))

    const messageCount = metric.metadata?.messageCount
    expect(typeof messageCount).toBe('number')
    expect(messageCount as number).toBeGreaterThan(0)

    const markNames = metric.marks.map(mark => mark.name)
    expect(markNames).toContain('pendingPlan.cleared')
    expect(markNames).toContain('messages.loaded')
    expect(markNames).toContain('session.flushed')
    expect(markNames).toContain('ack')
  }

  it('user message is on disk before onAck fires (normal branch)', async () => {
    const sessionId = 'durability-normal'
    buildSession(sessionId)
    const metrics = capturePerfMetrics()

    let ackedMessageId: string | null = null
    let onDiskAtAck = false
    let acceptMetricAtAck: CapturedPerfMetric | undefined

    // sendMessage continues past the ack into agent-init, which would throw
    // because we haven't called `setSessionPlatform()` in this minimal test
    // harness. That's fine — we only care about the persist+flush+ack ordering
    // that happens before agent-init. Catch the post-ack rejection.
    await sm
      .sendMessage(
        sessionId,
        'hello',
        undefined,
        undefined,
        undefined,
        undefined,
        (messageId) => {
          ackedMessageId = messageId
          onDiskAtAck = readPersistedMessageIds(sessionId).includes(messageId)
          acceptMetricAtAck = findAcceptMetric(metrics, 'accepted')
        },
      )
      .catch(() => { /* expected post-ack agent-init failure */ })

    expect(ackedMessageId).not.toBeNull()
    expect(onDiskAtAck).toBe(true)
    expectAcceptMetric(acceptMetricAtAck, 'accepted')
  })

  it('persists the first deterministic title in the same durable acceptance write', async () => {
    const sessionId = 'durability-first-title'
    const managed = buildSession(sessionId)
    managed.name = undefined
    const observedOrder: string[] = []
    let titleOnDiskAtAck: string | undefined

    sm.setEventSink((_channel, _target, event) => {
      if (event?.type === 'user_message' || event?.type === 'title_generated') {
        observedOrder.push(event.type)
      }
    })

    await sm
      .sendMessage(
        sessionId,
        'hello',
        undefined,
        undefined,
        undefined,
        undefined,
        () => {
          titleOnDiskAtAck = readPersistedTitle(sessionId)
          observedOrder.push('ack')
        },
      )
      .catch(() => { /* expected post-ack agent-init failure */ })

    expect(titleOnDiskAtAck).toBe('hello')
    expect(observedOrder.slice(0, 3)).toEqual(['ack', 'user_message', 'title_generated'])
  })

  it('names edit sessions from user intent and gives the same clean input to title inference', async () => {
    const managed = buildSession('edit-title')
    managed.name = undefined
    const metadata = '<edit_request><label>Scheduled Task</label><context>Create a scheduled task</context></edit_request>\n\n'
    const instruction = 'Remind me to write my weekly report on Friday'
    let titleInput: string | undefined
    ;(sm as any).generateTitle = async (_managed: unknown, input: string) => { titleInput = input }
    await sm.sendMessage('edit-title', metadata + instruction, undefined, undefined, {
      badges: [{ type: 'context', label: 'Scheduled Task', rawText: metadata, start: 0, end: metadata.length }],
    }).catch(() => { /* expected post-ack agent-init failure */ })
    expect(readPersistedTitle('edit-title')).toBe(instruction)
    expect(titleInput).toBe(instruction)
    expect(managed.messages[0]?.content).toBe(metadata + instruction)
  })

  it('queues a concurrent send while the first message is still being durably accepted', async () => {
    const managed = buildSession('concurrent-admission')
    let enterFlush!: () => void
    let releaseFlush!: () => void
    let finishChat!: () => void
    let acknowledgeSecond!: () => void
    const flushing = new Promise<void>(resolve => { enterFlush = resolve })
    const flushGate = new Promise<void>(resolve => { releaseFlush = resolve })
    const chatGate = new Promise<void>(resolve => { finishChat = resolve })
    const secondAck = new Promise<void>(resolve => { acknowledgeSecond = resolve })
    const flush = sm.flushSession.bind(sm)
    let firstFlush = true
    sm.flushSession = async id => {
      if (firstFlush) {
        firstFlush = false
        enterFlush()
        await flushGate
      }
      await flush(id)
    }
    const chats: string[] = []
    const agent = {
      getModel: () => 'test-model', setAllSources() {}, getSessionId: () => undefined, dispose() {},
      chat: async function* (message: string) {
        chats.push(message)
        if (message === 'first') await chatGate
        yield { type: 'text_complete', text: `reply:${message}` }
        yield { type: 'complete' }
      },
    }
    ;(sm as any).getOrCreateAgentLocked = async () => agent
    const first = sm.sendMessage(managed.id, 'first')
    await flushing
    const second = sm.sendMessage(managed.id, 'second', undefined, undefined, undefined, undefined, acknowledgeSecond)
    // Give the competing send time to reach admission while the first flush is blocked.
    await Bun.sleep(20)
    releaseFlush()
    try {
      await secondAck
      expect(managed.messages.find(message => message.content === 'second')?.isQueued).toBe(true)
      expect(managed.messageQueue).toHaveLength(1)
    } finally {
      finishChat()
      await Promise.all([first, second])
      for (let i = 0; i < 100 && (chats.length < 2 || (sm as any).agentLease.hasActiveOperations(managed.id)); i++) await Bun.sleep(5)
    }
    expect(chats).toEqual(['first', 'second'])
    expect(managed.messages.filter(message => message.role === 'assistant').map(message => message.content))
      .toEqual(['reply:first', 'reply:second'])
  })

  it('releases send admission when preflight fails so the next send can run', async () => {
    const managed = buildSession('admission-preflight-failure')
    const ensureMessagesLoaded = (sm as any).ensureMessagesLoaded.bind(sm)
    let first = true
    ;(sm as any).ensureMessagesLoaded = async (session: typeof managed) => {
      if (first) {
        first = false
        throw new Error('preflight unavailable')
      }
      await ensureMessagesLoaded(session)
    }
    ;(sm as any).getOrCreateAgentLocked = async () => ({
      getModel: () => 'test-model', setAllSources() {}, getSessionId: () => undefined, dispose() {},
      async *chat() { yield { type: 'text_complete', text: 'reply' }; yield { type: 'complete' } },
    })
    const failed = sm.sendMessage(managed.id, 'failed')
    const next = sm.sendMessage(managed.id, 'next')
    await expect(failed).rejects.toThrow('preflight unavailable')
    await next
    expect(managed.messages.filter(message => message.role === 'user').map(message => message.content)).toEqual(['next'])
    expect(managed.messages.some(message => message.content === 'reply')).toBe(true)
    expect((sm as any).agentLease.hasActiveOperations(managed.id)).toBe(false)
  })

  it('user message is on disk before onAck fires (mid-stream / queued branch)', async () => {
    const sessionId = 'durability-midstream'
    const managed = buildSession(sessionId)
    managed.isProcessing = true
    const metrics = capturePerfMetrics()
    const queuedOnDiskAtEvent: boolean[] = []
    sm.setEventSink((_channel, _target, event) => {
      if (event?.type === 'user_message' && event.status === 'queued') {
        queuedOnDiskAtEvent.push(readPersistedMessageIds(sessionId).includes(event.message.id))
      }
    })

    let ackedMessageId: string | null = null
    let onDiskAtAck = false
    let acceptMetricAtAck: CapturedPerfMetric | undefined

    await sm.sendMessage(
      sessionId,
      'queued message',
      undefined,
      undefined,
      undefined,
      undefined,
      (messageId) => {
        ackedMessageId = messageId
        onDiskAtAck = readPersistedMessageIds(sessionId).includes(messageId)
        acceptMetricAtAck = findAcceptMetric(metrics, 'queued')
      },
    )

    expect(ackedMessageId).not.toBeNull()
    expect(onDiskAtAck).toBe(true)
    expect(queuedOnDiskAtEvent).toEqual([true])
    expectAcceptMetric(acceptMetricAtAck, 'queued')

    const restoredManager = new SessionManager((_workspaceId, managed) => managed.workspace)
    const restored = createManagedSession(
      { id: sessionId, name: 'restored queue' },
      managed.workspace,
      { messagesLoaded: false, isProcessing: true },
    )
    ;(restoredManager as unknown as { sessions: Map<string, unknown> }).sessions.set(sessionId, restored)
    // Queue recovery now lives behind the SessionPersistence module.
    await ((restoredManager as unknown as {
      persistence: { loadMessagesFromDisk(session: typeof restored): Promise<void> }
    }).persistence).loadMessagesFromDisk(restored)
    expect(restored.messageQueue.map(entry => entry.messageId as string | null)).toEqual([ackedMessageId])
  })

  it('does not replay a deleted message after the Host process exits immediately', async () => {
    const managed = buildSession('queue-removal-restart')
    managed.messagesLoaded = false
    const run = Bun.spawnSync([process.execPath, '--eval', `
      import { SessionManager, createManagedSession } from ${JSON.stringify(import.meta.resolve('./SessionManager.ts'))};
      import { registerSessionsHandlers } from ${JSON.stringify(import.meta.resolve('../handlers/rpc/sessions.ts'))};
      import { RPC_CHANNELS } from '@craft-agent/shared/protocol';

      const manager = new SessionManager((_id, session) => session.workspace);
      const session = createManagedSession(
        { id: ${JSON.stringify(managed.id)} },
        ${JSON.stringify(managed.workspace)},
        { messagesLoaded: true, isProcessing: true },
      );
      manager['sessions'].set(session.id, session);
      const handlers = new Map();
      registerSessionsHandlers({ handle: (channel, handler) => handlers.set(channel, handler) }, {
        sessionManager: manager, platform: { logger: { error() {} } },
      });
      const ctx = ${JSON.stringify(rpcContext)};
      for (const id of ['removed', 'retained']) {
        await handlers.get(RPC_CHANNELS.sessions.SEND_MESSAGE)(ctx, session.id, id, undefined, undefined, { optimisticMessageId: id });
      }
      await handlers.get(RPC_CHANNELS.sessions.COMMAND)(ctx, session.id, { type: 'removeQueuedMessage', messageId: 'removed' });
      process.exit(0);
    `], { env: { ...process.env, CRAFT_CONFIG_DIR: join(tmpRoot, 'host') } })
    if (run.exitCode !== 0) throw new Error(run.stderr.toString())

    const replay = spyOn(sm, 'sendMessage').mockResolvedValue(undefined)
    const reopened = await rpcHandlers().get(RPC_CHANNELS.sessions.GET_MESSAGES)!(rpcContext, managed.id)
    await new Promise<void>(resolve => setImmediate(resolve))

    expect(reopened.messages.map((message: { id: string }) => message.id)).toEqual(['retained'])
    expect(replay.mock.calls.map(([, content]) => content)).toEqual(['retained'])
  })

  it('rejects queued removal on disk failure and preserves the accepted queue entry', async () => {
    const managed = buildSession('queue-removal-enospc')
    managed.isProcessing = true
    await sendViaRpc(managed.id, 'keep me', { optimisticMessageId: 'keep-me' })
    const originalQueue = [...managed.messageQueue]
    const removedEvents: string[] = []
    sm.setEventSink((_channel, _target, event) => {
      if (event?.type === 'queued_message_removed') removedEvents.push(event.messageId)
    })
    const writer = injectDiskFull(() => true)
    const remove = () => rpcHandlers().get(RPC_CHANNELS.sessions.COMMAND)!(
      rpcContext, managed.id, { type: 'removeQueuedMessage', messageId: 'keep-me' },
    )

    try {
      await expect(remove()).rejects.toThrow('ENOSPC')
      expect(managed.messageQueue).toEqual(originalQueue)
      expect(managed.messages.map(message => [message.id, message.isQueued])).toEqual([['keep-me', true]])
      expect(readPersistedMessageIds(managed.id)).toEqual(['keep-me'])
      expect(removedEvents).toEqual([])
    } finally {
      writer.mockRestore()
      sm['persistSession'](managed)
    }
    await remove()
    expect(removedEvents).toEqual(['keep-me'])
    expect(readPersistedMessageIds(managed.id)).toEqual([])
  })

  it('discards a failed queued send even if the active turn completes while that write is pending', async () => {
    const managed = buildSession('queue-write-enospc')
    const { entered, resume, chats } = blockFirstChat()
    const writing = Promise.withResolvers<void>()
    const failWrite = Promise.withResolvers<void>()
    const replyPublished = Promise.withResolvers<void>()
    const queuedEvents: string[] = []
    sm.setEventSink((_channel, _target, event) => {
      if (event?.type === 'user_message' && event.status === 'queued') queuedEvents.push(event.message.id)
      if (event?.type === 'text_complete') replyPublished.resolve()
    })
    const first = sm.sendMessage(managed.id, 'first')
    await entered
    let writes = 0
    const writer = injectDiskFull(async () => {
      if (++writes !== 1) return false
      writing.resolve()
      await failWrite.promise
      return true
    })
    const rejected = sendViaRpc(managed.id, 'rejected', { optimisticMessageId: 'rejected' })
    try {
      await writing.promise
      resume()
      await replyPublished.promise
      const flushingReply = sm.flushSession(managed.id)
      failWrite.resolve()
      await expect(rejected).rejects.toThrow('ENOSPC')
      await flushingReply
      await first
      expect(queuedEvents).toEqual([])
      expect(chats).toEqual(['first'])
      expect(managed.messageQueue).toEqual([])
      expect(managed.messages.map(message => message.content)).toEqual(['first', 'reply:first'])
      expect(readPersistedMessageIds(managed.id)).not.toContain('rejected')
    } finally {
      resume()
      failWrite.resolve()
      await Promise.allSettled([first, rejected])
      writer.mockRestore()
    }
  })

  it('cancels a queued send whose durable publication is still in progress', async () => {
    const managed = buildSession('stop-during-queue-write')
    const { entered, resume, chats } = blockFirstChat()
    const writing = Promise.withResolvers<void>()
    const finishWrite = Promise.withResolvers<void>()
    const completionQueued = Promise.withResolvers<void>()
    const queuedTexts: string[] = []
    sm.setEventSink((_channel, _target, event) => {
      if (event?.type === 'interrupted') queuedTexts.push(...(event.queuedMessages ?? []))
    })
    const first = sm.sendMessage(managed.id, 'first')
    await entered
    const writer = injectDiskFull(async () => {
      writing.resolve()
      await finishWrite.promise
      return false
    })
    const queued = sendViaRpc(managed.id, 'cancel this', { optimisticMessageId: 'cancel-this' })
    const lease = (sm as any).agentLease
    const acquireAdmission = lease.acquireSendAdmission.bind(lease)
    const replay = spyOn(sm as any, 'processNextQueuedMessage')
    const admission = spyOn(lease, 'acquireSendAdmission').mockImplementation((sessionId: string) => {
      completionQueued.resolve()
      return acquireAdmission(sessionId)
    })
    try {
      await writing.promise
      resume()
      await completionQueued.promise
      // Completion is already waiting for the write. Stop must still clear
      // the queued message before the completion can dispatch it.
      const stop = sm.cancelProcessing(managed.id)
      finishWrite.resolve()
      await Promise.all([first, queued, stop])
      await lease.waitForAgentRuntimeLeases(managed.id)
      expect(replay).not.toHaveBeenCalled()
      expect(chats).toEqual(['first'])
      expect(queuedTexts).toEqual(['cancel this'])
      expect(managed.messageQueue).toEqual([])
      expect(managed.stopRequested).toBe(false)
      expect(readPersistedMessageIds(managed.id)).not.toContain('cancel-this')
    } finally {
      resume()
      finishWrite.resolve()
      await Promise.allSettled([first, queued])
      replay.mockRestore()
      admission.mockRestore()
      writer.mockRestore()
    }
  })

  it('ends processing on persistent ENOSPC and recovers the reply and accepted queue on the next send', async () => {
    const managed = buildSession('completion-write-enospc')
    const { entered, resume, chats } = blockFirstChat()
    const events: string[] = []
    const pendingQueues: Array<string[] | undefined> = []
    const recovered = Promise.withResolvers<void>()
    sm.setEventSink((_channel, _target, event) => {
      if (event?.type === 'error') events.push(event.error)
      if (event?.type === 'complete') {
        events.push('complete')
        pendingQueues.push(event.pendingQueuedMessageIds)
        if (chats.length === 3) recovered.resolve()
      }
    })
    const first = sm.sendMessage(managed.id, 'first')
    await entered
    const accepted: string[] = []
    await sm.sendMessage(managed.id, 'already queued', undefined, undefined, undefined, undefined, id => accepted.push(id))
    let diskFull = true
    const writer = injectDiskFull(() => diskFull)
    try {
      resume()
      const [finished] = await Promise.allSettled([first])
      expect(managed.isProcessing).toBe(false)
      expect(finished.status).toBe('fulfilled')
      expect(events).toEqual([expect.stringContaining('Could not save the session'), 'complete'])
      expect(pendingQueues).toEqual([accepted])
      expect(chats).toEqual(['first'])
      expect(managed.messageQueue.map(entry => entry.messageId)).toEqual(accepted)
      const reply = managed.messages.find(message => message.content === 'reply:first')!
      expect(readPersistedMessageIds(managed.id)).not.toContain(reply.id)

      await expect(sendViaRpc(managed.id, 'still no space')).rejects.toThrow('ENOSPC')
      diskFull = false
      await expect(sendViaRpc(managed.id, 'next')).resolves.toMatchObject({ accepted: true })
      expect(readPersistedMessageIds(managed.id)).toContain(reply.id)
      await recovered.promise
      expect(chats).toEqual(['first', 'already queued', 'next'])
      expect(managed.messages.some(message => message.content === 'still no space')).toBe(false)
      expect(managed.isProcessing).toBe(false)
    } finally {
      writer.mockRestore()
      // Allow teardown to flush even when this test is run against the unfixed Host.
      ;(sm as any).persistSession(managed)
    }
  })

  it('dequeues a replay only inside the durable send transaction', async () => {
    const sessionId = 'durability-queued-replay'
    const managed = buildSession(sessionId)
    managed.messages = [
      { id: 'queued-1', role: 'user', content: 'later', timestamp: 1, isQueued: true },
      { id: 'answer-1', role: 'assistant', content: 'done', timestamp: 2 },
    ] as never
    managed.messageQueue = [{ message: 'later', messageId: 'queued-1' }]
    const agent = {
      getModel: () => 'test-model',
      setAllSources: () => {},
      getSessionId: () => undefined,
      chat: async function* () { yield { type: 'complete' } },
    }
    ;(sm as any).getOrCreateAgentLocked = async () => agent
    let durableAtAck = false

    await sm.sendMessage(
      sessionId,
      'later',
      undefined,
      undefined,
      undefined,
      'queued-1',
      () => {
        durableAtAck = managed.messageQueue.length === 0
          && readPersistedMessageIds(sessionId).at(-1) === 'queued-1'
      },
    )

    expect(durableAtAck).toBe(true)
    expect(managed.messageQueue).toEqual([])
    expect(managed.messages.map(message => message.id)).toEqual(['answer-1', 'queued-1'])
  })

  it('retains the original queued sends when replay cannot write and executes them in order after recovery', async () => {
    const managed = buildSession('replay-write-enospc')
    const { entered, resume, chats, inputs } = blockFirstChat()
    const attachment: FileAttachment = {
      type: 'text', path: join(tmpRoot, 'notes.txt'), name: 'notes.txt', mimeType: 'text/plain', size: 5, text: 'notes',
    }
    const storedAttachment: StoredAttachment = {
      id: 'notes', type: 'text', name: attachment.name, mimeType: attachment.mimeType, size: attachment.size,
      storedPath: attachment.path,
    }
    const options = { optimisticMessageId: 'queued-head', oneTimeContext: 'original context' }
    const failed = Promise.withResolvers<void>()
    const recovered = Promise.withResolvers<void>()
    const processedIds: string[] = []
    sm.setEventSink((_channel, _target, event) => {
      if (event?.type === 'typed_error' && event.error.code === 'queued_message_replay_failed') failed.resolve()
      if (event?.type === 'user_message' && event.status === 'processing') processedIds.push(event.message.id)
      if (event?.type === 'complete' && chats.length === 4) recovered.resolve()
    })

    await sendViaRpc(managed.id, 'first')
    await entered
    await expect(sendViaRpc(managed.id, 'head', options, [attachment], [storedAttachment]))
      .resolves.toEqual({ accepted: true, messageId: 'queued-head' })
    await sendViaRpc(managed.id, 'tail', { optimisticMessageId: 'queued-tail' })
    const original = managed.messages.find(message => message.id === options.optimisticMessageId)!
    const readPersistedHead = () => readFileSync(getSessionFilePath(tmpRoot, managed.id), 'utf-8')
      .trim().split('\n').slice(1).map(line => JSON.parse(line)).find(message => message.id === original.id)

    let diskFull = true
    const writer = injectDiskFull(data => diskFull && data.trim().split('\n').slice(1)
      .map(line => JSON.parse(line)).some(message => message.id === original.id && !message.isQueued))
    try {
      resume()
      await failed.promise
      expect(chats).toEqual(['first'])
      expect(managed.messageQueue.map(entry => entry.messageId)).toEqual(['queued-head', 'queued-tail'])
      expect(managed.messages.find(message => message.id === original.id)).toMatchObject({ isQueued: true })
      expect(readPersistedHead()).toMatchObject({ isQueued: true, attachments: [storedAttachment] })

      diskFull = false
      await expect(sendViaRpc(managed.id, 'next', { optimisticMessageId: 'queued-next' }))
        .resolves.toMatchObject({ accepted: true })
      await recovered.promise
      expect(chats).toEqual(['first', 'head', 'tail', 'next'])
      expect(processedIds).toEqual(['queued-head', 'queued-tail', 'queued-next'])
      expect(inputs[1]).toEqual({ attachments: [attachment], oneTimeContext: options.oneTimeContext })
      expect(readPersistedHead()).toMatchObject({ isQueued: false, attachments: [storedAttachment] })
      expect(managed.messageQueue).toEqual([])
    } finally {
      writer.mockRestore()
      // Replace the rejected write tail when this test runs on the unfixed Host.
      ;(sm as any).persistSession(managed)
    }
  })

  it('briefs outside text changes and keeps one-time and interruption context out of the durable model message', async () => {
    const sessionId = 'transient-turn-context'
    const managed = buildSession(sessionId)
    let captured: { message: string; oneTimeContext?: string; turnPolicy?: string } | undefined
    ;(sm as unknown as { getOrCreateAgentLocked: () => Promise<unknown> }).getOrCreateAgentLocked = async () => ({
      getModel: () => 'test-model',
      setAllSources: () => {},
      getSessionId: () => undefined,
      chat: async function* (
        message: string,
        _attachments: unknown,
        options: { oneTimeContext?: string; turnPolicy?: string },
      ) {
        captured = {
          message,
          oneTimeContext: options.oneTimeContext,
          turnPolicy: options.turnPolicy,
        }
        yield { type: 'complete' }
      },
    })

    // The first turn sets the baseline; the agent's own turn is not an outside change.
    await sm.sendMessage(sessionId, 'first')
    expect(captured?.oneTimeContext ?? '').not.toContain('<workspace-brief>')
    writeFileSync(join(tmpRoot, 'chapter-outside.md'), 'edited outside the conversation\n')
    managed.wasInterrupted = true

    await sm.sendMessage(sessionId, 'hello', undefined, undefined, { oneTimeContext: 'OTHER TRANSIENT DATA' })

    expect(captured?.message).toBe('hello')
    expect(captured?.oneTimeContext).toContain('OTHER TRANSIENT DATA')
    expect(captured?.oneTimeContext).toContain('- chapter-outside.md added')
    expect(captured?.turnPolicy).toContain('previous assistant response was interrupted')
    expect(captured?.turnPolicy).toContain('Before editing any listed file, read its latest content first')
    expect(managed.wasInterrupted).toBe(false)
    expect(readFileSync(getSessionFilePath(tmpRoot, sessionId), 'utf-8'))
      .not.toContain('chapter-outside.md')
  })

  it('shares one-shot queries with chat while disposal waits for the chat lease', async () => {
    const sessionId = 'chat-runtime-lease'
    const managed = buildSession(sessionId)
    managed.llmConnection = 'lease-test'
    let markStarted!: () => void
    let finishChat!: () => void
    const started = new Promise<void>(resolve => { markStarted = resolve })
    const chatGate = new Promise<void>(resolve => { finishChat = resolve })
    let disposeCalls = 0
    const agent = {
      isProcessing: () => false,
      getModel: () => 'test-model',
      setAllSources: () => {},
      getSessionId: () => undefined,
      dispose: () => { disposeCalls++ },
      forceAbort: () => {},
      queryLlm: async () => ({ text: 'rewritten', model: 'test-model' }),
      chat: async function* () {
        markStarted()
        await chatGate
        yield { type: 'complete' }
      },
    }
    managed.agent = agent as never
    ;(sm as any).getOrCreateAgentLocked = async () => agent

    const send = sm.sendMessage(sessionId, 'hi')
    await started

    await expect(sm.queryOnce(sessionId, { prompt: 'rewrite' }))
      .resolves.toEqual({ text: 'rewritten', model: 'test-model' })

    const disposal = sm.disposeConnectionRuntimes('lease-test')
    await Promise.resolve()
    expect(disposeCalls).toBe(0)

    finishChat()
    await send
    await disposal
    expect(disposeCalls).toBe(1)
  })

  it('defers source runtime mutation until the active chat lease settles', async () => {
    const sessionId = 'chat-source-writer'
    const managed = buildSession(sessionId)
    let markStarted!: () => void
    let finishChat!: () => void
    const started = new Promise<void>(resolve => { markStarted = resolve })
    const chatGate = new Promise<void>(resolve => { finishChat = resolve })
    let sourceUpdateCalls = 0
    const agent = {
      isProcessing: () => false,
      getModel: () => 'test-model',
      getSessionId: () => undefined,
      getSummarizeCallback: () => async () => null,
      setAllSources: () => {},
      applyBridgeUpdates: async () => {},
      setSourceServers: async () => { sourceUpdateCalls++ },
      chat: async function* () {
        markStarted()
        await chatGate
        yield { type: 'complete' }
      },
    }
    managed.agent = agent as never
    ;(sm as any).getOrCreateAgentLocked = async () => agent

    const send = sm.sendMessage(sessionId, 'hi')
    await started
    const sourceUpdate = sm.setSessionSources(sessionId, [])
    await Promise.resolve()
    expect(sourceUpdateCalls).toBe(0)

    finishChat()
    await send
    await sourceUpdate
    expect(sourceUpdateCalls).toBe(1)
    await sm.flushSession(sessionId)
  })

  it('does not recreate or persist a session after deletion starts', async () => {
    const sessionId = 'delete-runtime-tombstone'
    const managed = buildSession(sessionId)
    managed.name = undefined
    let markStarted!: () => void
    let finishChat!: () => void
    const started = new Promise<void>(resolve => { markStarted = resolve })
    const chatGate = new Promise<void>(resolve => { finishChat = resolve })
    let titleCalls = 0
    const agent = {
      isProcessing: () => false,
      getModel: () => 'test-model',
      getSessionId: () => undefined,
      setAllSources: () => {},
      dispose: () => {},
      forceAbort: () => { finishChat() },
      generateTitle: async () => {
        titleCalls++
        return 'stale title'
      },
      chat: async function* () {
        markStarted()
        await chatGate
        yield { type: 'complete' }
      },
    }
    managed.agent = agent as never
    ;(sm as any).getOrCreateAgentLocked = async () => agent

    const send = sm.sendMessage(sessionId, 'Investigate runtime deletion safety')
    await started
    const deletion = sm.deleteSession(sessionId)
    // The acceptance path is already covered by `acked`; the minimal harness
    // intentionally has no session platform for the post-ack agent init.
    await Promise.all([send.catch(() => {}), deletion])
    await Promise.resolve()

    expect(titleCalls).toBe(0)
    expect((sm as unknown as { sessions: Map<string, unknown> }).sessions.has(sessionId)).toBe(false)
    expect(existsSync(getSessionFilePath(tmpRoot, sessionId))).toBe(false)
  })

  it('rejects metadata persistence after durable deletion commits', async () => {
    const sessionId = 'delete-metadata-tombstone'
    const managed = buildSession(sessionId)
    managed.sharedId = 'shared-delete-window'
    ;(sm as unknown as { persistSession(session: typeof managed): void }).persistSession(managed)
    await sm.flushSession(sessionId)

    const originalFetch = globalThis.fetch
    let markShareRevokeStarted!: () => void
    let finishShareRevoke!: () => void
    const shareRevokeStarted = new Promise<void>(resolve => { markShareRevokeStarted = resolve })
    const shareRevokeGate = new Promise<void>(resolve => { finishShareRevoke = resolve })
    const revokeRequests: Array<{ url: string; method?: string }> = []
    globalThis.fetch = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      revokeRequests.push({ url: String(input), method: init?.method })
      markShareRevokeStarted()
      await shareRevokeGate
      return new Response(null, { status: 204 })
    }) as unknown as typeof fetch

    try {
      const deletion = sm.deleteSession(sessionId)
      await shareRevokeStarted
      expect(revokeRequests).toEqual([{
        url: 'https://agents.craft.do/s/api/shared-delete-window',
        method: 'DELETE',
      }])
      expect(existsSync(getSessionFilePath(tmpRoot, sessionId))).toBe(false)

      await sm.setSessionStatus(sessionId, 'done')
      finishShareRevoke()
      await deletion

      expect((sm as unknown as { sessions: Map<string, unknown> }).sessions.has(sessionId)).toBe(false)
      expect(existsSync(getSessionFilePath(tmpRoot, sessionId))).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
      finishShareRevoke()
    }
  })

  it('waits for an accepted direct metadata writer before durable deletion', async () => {
    const sessionId = 'delete-share-lease'
    const managed = buildSession(sessionId)
    managed.sharedId = 'shared-id'
    managed.sharedUrl = 'https://viewer.example/shared-id'
    ;(sm as unknown as { persistSession(session: typeof managed): void }).persistSession(managed)
    await sm.flushSession(sessionId)

    const originalFetch = globalThis.fetch
    let markShareStarted!: () => void
    let finishShare!: () => void
    const shareStarted = new Promise<void>(resolve => { markShareStarted = resolve })
    const shareGate = new Promise<void>(resolve => { finishShare = resolve })
    globalThis.fetch = (async (
      _input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      if (init?.method === 'DELETE') {
        markShareStarted()
        await shareGate
        return new Response(null, { status: 204 })
      }
      return new Response(null, { status: 204 })
    }) as unknown as typeof fetch

    try {
      const sharing = sm.revokeShare(sessionId)
      await shareStarted
      let deletionFinished = false
      const deletion = sm.deleteSession(sessionId).then(() => { deletionFinished = true })
      await Promise.resolve()

      expect(managed.runtimeState).toBe('deleting')
      expect(deletionFinished).toBe(false)
      expect(existsSync(getSessionFilePath(tmpRoot, sessionId))).toBe(true)

      finishShare()
      await expect(sharing).resolves.toEqual({ success: true })
      await deletion

      expect(existsSync(getSessionFilePath(tmpRoot, sessionId))).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
      finishShare()
    }
  })

  it('waits for an accepted Session-path write before durable deletion', async () => {
    const sessionId = 'delete-session-path-lease'
    const managed = buildSession(sessionId)
    ;(sm as unknown as { persistSession(session: typeof managed): void }).persistSession(managed)
    await sm.flushSession(sessionId)

    let markOperationStarted!: () => void
    let allowWrite!: () => void
    let markWriteFinished!: () => void
    let finishOperation!: () => void
    const operationStarted = new Promise<void>(resolve => { markOperationStarted = resolve })
    const writeGate = new Promise<void>(resolve => { allowWrite = resolve })
    const writeFinished = new Promise<void>(resolve => { markWriteFinished = resolve })
    const operationGate = new Promise<void>(resolve => { finishOperation = resolve })
    const notePath = join(tmpRoot, '.craft-agent', 'sessions', sessionId, 'notes.md')

    const pathWrite = sm.withSessionPathOperation(sessionId, async sessionPath => {
      markOperationStarted()
      await writeGate
      writeFileSync(join(sessionPath, 'notes.md'), 'accepted write')
      markWriteFinished()
      await operationGate
    })
    await operationStarted

    let deletionFinished = false
    const deletion = sm.deleteSession(sessionId).then(() => { deletionFinished = true })
    await Promise.resolve()
    expect(managed.runtimeState).toBe('deleting')
    expect(deletionFinished).toBe(false)

    allowWrite()
    await writeFinished
    expect(existsSync(notePath)).toBe(true)
    expect(deletionFinished).toBe(false)

    finishOperation()
    await Promise.all([pathWrite, deletion])
    expect(existsSync(notePath)).toBe(false)
  })

  it('waits for an accepted export before durable deletion', async () => {
    const sessionId = 'delete-export-lease'
    const managed = buildSession(sessionId)
    ;(sm as unknown as { persistSession(session: typeof managed): void }).persistSession(managed)
    await sm.flushSession(sessionId)

    let markExportStarted!: () => void
    let finishExport!: () => void
    const exportStarted = new Promise<void>(resolve => { markExportStarted = resolve })
    const exportGate = new Promise<void>(resolve => { finishExport = resolve })
    ;(sm as any).exportImport.exportSession = async () => {
      markExportStarted()
      await exportGate
      return null
    }

    const exporting = sm.exportSession(sessionId, 'ws_test')
    await exportStarted
    let deletionFinished = false
    const deletion = sm.deleteSession(sessionId).then(() => { deletionFinished = true })
    await Promise.resolve()

    expect(managed.runtimeState).toBe('deleting')
    expect(deletionFinished).toBe(false)

    finishExport()
    await expect(exporting).resolves.toBeNull()
    await deletion
    expect(existsSync(getSessionFilePath(tmpRoot, sessionId))).toBe(false)
  })

  it('does not let deletion race ahead of an accepted send transaction', async () => {
    const sessionId = 'delete-send-acceptance'
    const managed = buildSession(sessionId)
    let markPreflightStarted!: () => void
    let finishPreflight!: () => void
    const preflightStarted = new Promise<void>(resolve => { markPreflightStarted = resolve })
    const preflightGate = new Promise<void>(resolve => { finishPreflight = resolve })
    ;(sm as unknown as {
      ensureMessagesLoaded(session: typeof managed): Promise<void>
    }).ensureMessagesLoaded = async () => {
      markPreflightStarted()
      await preflightGate
    }

    let acked = false
    const send = sm.sendMessage(
      sessionId,
      'accepted before deletion',
      undefined,
      undefined,
      undefined,
      undefined,
      () => { acked = true },
    )
    await preflightStarted
    const deletion = sm.deleteSession(sessionId)
    await Promise.resolve()
    expect(managed.runtimeState).toBe('deleting')

    finishPreflight()
    await Promise.all([send, deletion])

    expect(acked).toBe(true)
    expect((sm as unknown as { sessions: Map<string, unknown> }).sessions.has(sessionId)).toBe(false)
    expect(existsSync(getSessionFilePath(tmpRoot, sessionId))).toBe(false)
  })

  it('only auto-deletes a known empty idle Session', async () => {
    const managed = buildSession('conditional-delete')
    ;(sm as any).persistSession(managed)
    await sm.flushSession(managed.id)
    managed.messagesLoaded = false
    expect(await sm.deleteEmptySession(managed.id)).toBe(false)
    expect(existsSync(getSessionFilePath(tmpRoot, managed.id))).toBe(true)
    managed.messagesLoaded = true
    expect(await sm.deleteEmptySession(managed.id)).toBe(true)
    expect(existsSync(getSessionFilePath(tmpRoot, managed.id))).toBe(false)
  })

  it('preserves an accepted send before and after its durable acknowledgement', async () => {
    const managed = buildSession('conditional-delete-send')
    let entered!: () => void
    let resume!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { resume = resolve })
    ;(sm as any).ensureMessagesLoaded = async () => { entered(); await gate }
    let acked = false
    const send = sm.sendMessage(managed.id, 'Keep my request', undefined, undefined, undefined, undefined, () => { acked = true })
    await started
    try {
      expect(await sm.deleteEmptySession(managed.id)).toBe(false)
    } finally {
      resume()
      await send
    }
    expect(acked).toBe(true)
    expect(await sm.deleteEmptySession(managed.id)).toBe(false)
    expect(readPersistedMessageIds(managed.id).length).toBeGreaterThan(0)
  })

  it('releases the Project lock before waiting for the active runtime lease', async () => {
    const sessionId = 'delete-spawn-lock-order'
    const managed = buildSession(sessionId)
    ;(sm as unknown as { persistSession(session: typeof managed): void }).persistSession(managed)
    await sm.flushSession(sessionId)

    let markQueryStarted!: () => void
    let allowSpawn!: () => void
    const queryStarted = new Promise<void>(resolve => { markQueryStarted = resolve })
    const spawnGate = new Promise<void>(resolve => { allowSpawn = resolve })
    ;(sm as any).createSessionLocked = async () => ({ id: 'spawned-during-delete' })
    const agent = {
      dispose: () => {},
      queryLlm: async () => {
        markQueryStarted()
        await spawnGate
        await sm.createSession('ws_test')
        return { text: 'done', model: 'test-model' }
      },
    }
    managed.agent = agent as never
    ;(sm as any).getOrCreateAgentLocked = async () => agent

    const query = sm.queryOnce(sessionId, { prompt: 'spawn' } as never)
    await queryStarted
    const deletion = sm.deleteSession(sessionId)
    while (managed.runtimeState !== 'deleting') await Promise.resolve()

    allowSpawn()
    let timeoutId: ReturnType<typeof setTimeout>
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Project/runtime lock inversion')), 1_000)
    })
    await expect(Promise.race([Promise.all([query, deletion]), timeout])).resolves.toBeDefined()
    clearTimeout(timeoutId!)
    expect(existsSync(getSessionFilePath(tmpRoot, sessionId))).toBe(false)
  })

  it('durably completes once with facade, first-event, and turn-usage evidence', async () => {
    const sessionId = 'agent-readiness-metrics'
    buildSession(sessionId)
    const metrics: CapturedPerfMetric[] = []
    const completedWriteMessageCounts: number[] = []
    let assistantCompleted = false
    configurePerfTracking({
      enabled: true,
      onMetric: metric => {
        metrics.push(metric)
        if (assistantCompleted && metric.name === 'session.persist.write') {
          completedWriteMessageCounts.push(Number(metric.metadata?.messageCount))
        }
      },
    })
    sm.setEventSink((_channel, _target, event) => {
      if (event?.type === 'text_complete') assistantCompleted = true
    })
    await sm.setActiveViewingSession(sessionId, 'ws_test')
    ;(sm as unknown as { getOrCreateAgentLocked: () => Promise<unknown> }).getOrCreateAgentLocked = async () => ({
      getModel: () => 'test-model',
      setAllSources: () => {},
      getSessionId: () => undefined,
      chat: async function* () {
        yield { type: 'status', message: 'starting' }
        yield { type: 'text_complete', text: 'done' }
        yield {
          type: 'complete',
          usage: {
            inputTokens: 13,
            outputTokens: 7,
            modelCalls: 1,
            cacheReadTokens: 5,
            costUsd: 0,
            contextTokens: 13,
            contextWindow: 100,
          },
        }
      },
    })

    await sm.sendMessage(sessionId, 'hello')

    const sendMetric = metrics.find(metric => metric.name === 'session.sendMessage')
    const marks = sendMetric?.marks.map(mark => mark.name) ?? []
    expect(marks).toContain('agent.facade.ready')
    expect(marks.filter(mark => mark === 'agent.first_event')).toHaveLength(1)
    expect(sendMetric?.metadata?.usage).toEqual(expect.objectContaining({
      modelCalls: 1,
      inputTokens: 13,
      outputTokens: 7,
      cacheReadTokens: 5,
    }))
    expect(completedWriteMessageCounts).toEqual([2])
    expect(sessionPersistenceQueue.hasPending(sessionId)).toBe(false)
  })
})

describe('plan submission durability', () => {
  let tmpRoot: string
  let sm: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-plan-durability-'))
    sm = new SessionManager((_workspaceId, managed) => managed.workspace)
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('persists and emits usage before completing a plan handoff', async () => {
    const sessionId = 'plan-durability'
    const managed = createManagedSession(
      { id: sessionId, name: 'plan durability' },
      {
        id: 'ws_test',
        name: 'Test Workspace',
        rootPath: tmpRoot,
        createdAt: Date.now(),
      } as never,
      { messagesLoaded: true },
    )
    managed.isProcessing = true
    managed.turnStartedAt = Date.now() - 1_000
    managed.agent = {
      getCurrentTurnUsage: () => ({
        inputTokens: 12,
        outputTokens: 3,
        cacheReadTokens: 4,
        costUsd: 0.02,
      }),
      interruptForHandoff: () => {},
    } as never
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(sessionId, managed)

    const planPath = join(tmpRoot, 'PLAN.md')
    writeFileSync(planPath, '# Test plan', 'utf-8')

    let onDiskAtComplete = false
    let completeEvent: Record<string, unknown> | undefined
    sm.setEventSink((_channel, _target, event) => {
      if (event?.type !== 'complete') return
      completeEvent = event

      const path = getSessionFilePath(tmpRoot, sessionId)
      if (!existsSync(path)) return

      const lines = readFileSync(path, 'utf-8').trim().split('\n')
      const persistedPlan = lines
        .slice(1)
        .map(l => JSON.parse(l))
        .find(m => m.type === 'plan' && m.content === '# Test plan')
      onDiskAtComplete = persistedPlan?.turnMetrics?.usage?.inputTokens === 12
    })

    await (sm as unknown as {
      handlePlanSubmitted(managed: unknown, planPath: string): Promise<void>
    }).handlePlanSubmitted(managed, planPath)

    expect(onDiskAtComplete).toBe(true)
    expect(completeEvent?.tokenUsage).toEqual(expect.objectContaining({
      inputTokens: 12,
      outputTokens: 3,
      totalTokens: 15,
      cacheReadTokens: 4,
      costUsd: 0.02,
    }))
    expect(completeEvent?.turnMetrics).toEqual([
      expect.objectContaining({
        messageId: expect.stringMatching(/^plan-/),
        metrics: expect.objectContaining({
          usage: expect.objectContaining({ inputTokens: 12, outputTokens: 3 }),
        }),
      }),
    ])
    expect(managed.tokenUsage).toEqual(expect.objectContaining({
      inputTokens: 12,
      outputTokens: 3,
      totalTokens: 15,
    }))
    expect(Object.values(managed.tokenUsage?.byDay ?? {})).toEqual([{
      inputTokens: 12,
      outputTokens: 3,
      totalTokens: 15,
    }])
  })
})
