// input: SessionManager persistence, transient context, performance hooks, and Pi runtime lifecycle
// output: Regression coverage for durable messages, compatible leases, exclusive mutations, and deletion tombstones
// pos: Guards send acceptance and runtime ownership across concurrent session operations

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getSessionFilePath, sessionPersistenceQueue } from '@craft-agent/shared/sessions/storage'
import { clearMetrics, configurePerfTracking } from '@craft-agent/shared/utils'
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
    sm = new SessionManager()
    clearMetrics()
  })

  afterEach(() => {
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
      rootPath: tmpRoot,
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

  it('user message is on disk before onAck fires (mid-stream / queued branch)', async () => {
    const sessionId = 'durability-midstream'
    const managed = buildSession(sessionId)
    // Force the mid-stream branch. Agent is null, so redirect() falls back to
    // false and the queue path runs.
    managed.isProcessing = true
    const metrics = capturePerfMetrics()

    let ackedMessageId: string | null = null
    let onDiskAtAck = false
    let acceptMetricAtAck: CapturedPerfMetric | undefined

    await sm.sendMessage(
      sessionId,
      'queued message',
      undefined,
      undefined,
      { workspaceFreshnessContext: 'read chapter-2.md before editing' },
      undefined,
      (messageId) => {
        ackedMessageId = messageId
        onDiskAtAck = readPersistedMessageIds(sessionId).includes(messageId)
        acceptMetricAtAck = findAcceptMetric(metrics, 'queued')
      },
    )

    expect(ackedMessageId).not.toBeNull()
    expect(onDiskAtAck).toBe(true)
    expectAcceptMetric(acceptMetricAtAck, 'queued')

    const restoredManager = new SessionManager()
    const restored = createManagedSession(
      { id: sessionId, name: 'restored queue' },
      managed.workspace,
      { messagesLoaded: false, isProcessing: true },
    )
    ;(restoredManager as unknown as { sessions: Map<string, unknown> }).sessions.set(sessionId, restored)
    await (restoredManager as unknown as {
      loadMessagesFromDisk(session: typeof restored): Promise<void>
    }).loadMessagesFromDisk(restored)
    expect(restored.messageQueue[0]?.options?.workspaceFreshnessContext)
      .toBe('read chapter-2.md before editing')
  })

  it('keeps one-time and interruption context out of the durable model message', async () => {
    const sessionId = 'transient-turn-context'
    const managed = buildSession(sessionId)
    managed.wasInterrupted = true
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

    await sm.sendMessage(
      sessionId,
      'hello',
      undefined,
      undefined,
      {
        oneTimeContext: 'OTHER TRANSIENT DATA',
        workspaceFreshnessContext: '<workspace-brief>\nNOVEL WORKSPACE BRIEF\n</workspace-brief>',
      },
    )

    expect(captured?.message).toBe('hello')
    expect(captured?.oneTimeContext).toContain('OTHER TRANSIENT DATA')
    expect(captured?.oneTimeContext).toContain('NOVEL WORKSPACE BRIEF')
    expect(captured?.turnPolicy).toContain('previous assistant response was interrupted')
    expect(captured?.turnPolicy).toContain('Before editing any listed file, read its latest content first')
    expect(managed.wasInterrupted).toBe(false)
    expect(readFileSync(getSessionFilePath(tmpRoot, sessionId), 'utf-8'))
      .not.toContain('NOVEL WORKSPACE BRIEF')
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
    await Promise.all([send, deletion])
    await Promise.resolve()

    expect(titleCalls).toBe(0)
    expect((sm as unknown as { sessions: Map<string, unknown> }).sessions.has(sessionId)).toBe(false)
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
    sm.setActiveViewingSession(sessionId, 'ws_test')
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
    sm = new SessionManager()
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
  })
})
