// input: SessionManager sendMessage persistence and performance tracking hooks
// output: Regression coverage for pre-ack disk durability and accept-span evidence
// pos: Guards sendMessage ack ordering before provider agent initialization

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
    expectAcceptMetric(acceptMetricAtAck, 'queued')
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
    ;(sm as unknown as { getOrCreateAgent: () => Promise<unknown> }).getOrCreateAgent = async () => ({
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
