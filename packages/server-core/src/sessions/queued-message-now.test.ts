// input: SessionManager queued-message runtime state.
// output: Regression coverage for promoting one queued message and interrupting the active turn.
// pos: Guards mid-stream queued message "send now" behavior.

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AbortReason } from '@craft-agent/shared/agent/backend/types'
import { SessionManager, createManagedSession } from './SessionManager.ts'

describe('queued message send-now', () => {
  let tmpRoot: string
  let sm: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-queued-now-'))
    sm = new SessionManager()
  })

  afterEach(async () => {
    await sm.flushAllSessions()
    sm.cleanup()
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function buildProcessingSession() {
    const sessionId = 'queued-now-session'
    const managed = createManagedSession(
      { id: sessionId, name: 'queued now' },
      {
        id: 'ws_test',
        name: 'Test Workspace',
        rootPath: tmpRoot,
        createdAt: Date.now(),
      } as never,
      { messagesLoaded: true },
    )
    managed.isProcessing = true
    managed.messages = [
      { id: 'first', role: 'user', content: 'first', timestamp: 1 },
      { id: 'q1', role: 'user', content: 'later', timestamp: 2, isQueued: true },
      { id: 'q2', role: 'user', content: 'now', timestamp: 3, isQueued: true },
    ] as never
    managed.messageQueue = [
      { message: 'later', messageId: 'q1' },
      { message: 'now', messageId: 'q2' },
    ]

    const forceAbort = mock((_reason: AbortReason) => {})
    managed.agent = { forceAbort } as never
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(sessionId, managed)

    return { sessionId, managed, forceAbort }
  }

  it('promotes the selected queued message and interrupts without clearing the queue', async () => {
    const { sessionId, managed, forceAbort } = buildProcessingSession()
    const events: unknown[] = []
    sm.setEventSink((_channel, _target, event) => {
      events.push(event)
    })

    await (sm as unknown as {
      sendQueuedMessageNow(sessionId: string, messageId: string): Promise<void>
    }).sendQueuedMessageNow(sessionId, 'q2')

    expect(managed.messageQueue.map(entry => entry.messageId)).toEqual(['q2', 'q1'])
    expect(managed.messages.filter(message => message.isQueued).map(message => message.id)).toEqual(['q1', 'q2'])
    expect(forceAbort).toHaveBeenCalledWith(AbortReason.Redirect)
    expect(managed.stopRequested).toBe(true)
    expect(managed.wasInterrupted).toBe(true)
    expect(events).toContainEqual({
      type: 'interrupted',
      sessionId,
      reason: 'queued_handoff',
    })
  })

  it('queues an ordinary mid-stream send without redirecting the active turn', async () => {
    const sessionId = 'ordinary-queue-session'
    const managed = createManagedSession(
      { id: sessionId, name: 'ordinary queue' },
      {
        id: 'ws_test',
        name: 'Test Workspace',
        rootPath: tmpRoot,
        createdAt: Date.now(),
      } as never,
      { messagesLoaded: true },
    )
    managed.isProcessing = true
    const redirect = mock((_message: string) => true)
    const forceAbort = mock((_reason: AbortReason) => {})
    managed.agent = { redirect, forceAbort } as never
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(sessionId, managed)

    const events: unknown[] = []
    sm.setEventSink((_channel, _target, event) => {
      events.push(event)
    })

    await sm.sendMessage(sessionId, 'queue this')

    expect(redirect).not.toHaveBeenCalled()
    expect(forceAbort).not.toHaveBeenCalled()
    expect(managed.messageQueue.map(entry => entry.message)).toEqual(['queue this'])
    expect(events).toContainEqual(expect.objectContaining({
      type: 'user_message',
      sessionId,
      status: 'queued',
    }))
  })

  it('moves a replayed queued message after the completed response', () => {
    const { sessionId, managed } = buildProcessingSession()
    managed.messages = [
      { id: 'first', role: 'user', content: 'first', timestamp: 1 },
      { id: 'q1', role: 'user', content: 'later', timestamp: 2, isQueued: true },
      { id: 'answer', role: 'assistant', content: 'done', timestamp: 3 },
    ] as never
    managed.messageQueue = [{ message: 'later', messageId: 'q1' }]

    const events: unknown[] = []
    sm.setEventSink((_channel, _target, event) => {
      events.push(event)
    })
    const replay = mock(async () => {})
    const internal = sm as unknown as {
      sendMessage: typeof replay
      processNextQueuedMessage(sessionId: string): void
    }
    internal.sendMessage = replay

    internal.processNextQueuedMessage(sessionId)

    expect(managed.messages.map(message => message.id)).toEqual(['first', 'answer', 'q1'])
    expect(managed.messages[2]?.timestamp).toBeGreaterThan(3)
    expect(events).toContainEqual(expect.objectContaining({
      type: 'user_message',
      status: 'processing',
      message: expect.objectContaining({ id: 'q1', isQueued: false }),
    }))
  })

  it('removes a queued message without interrupting the active turn', async () => {
    const { sessionId, managed, forceAbort } = buildProcessingSession()
    const events: unknown[] = []
    sm.setEventSink((_channel, _target, event) => {
      events.push(event)
    })

    await (sm as unknown as {
      removeQueuedMessage(sessionId: string, messageId: string): Promise<void>
    }).removeQueuedMessage(sessionId, 'q1')

    expect(managed.messageQueue.map(entry => entry.messageId)).toEqual(['q2'])
    expect(managed.messages.map(message => message.id)).toEqual(['first', 'q2'])
    expect(forceAbort).not.toHaveBeenCalled()
    expect(events).toContainEqual({
      type: 'queued_message_removed',
      sessionId,
      messageId: 'q1',
    })
  })

  it('keeps an accepted queue mutation ahead of runtime invalidation', async () => {
    const { sessionId, managed } = buildProcessingSession()
    managed.isProcessing = false
    managed.agent = null
    managed.llmConnection = 'test-connection'
    managed.messagesLoaded = false
    let markHydrationStarted!: () => void
    let finishHydration!: () => void
    const hydrationStarted = new Promise<void>(resolve => { markHydrationStarted = resolve })
    const hydrationGate = new Promise<void>(resolve => { finishHydration = resolve })
    ;(sm as unknown as {
      ensureMessagesLoaded(session: typeof managed): Promise<void>
    }).ensureMessagesLoaded = async () => {
      markHydrationStarted()
      await hydrationGate
    }

    const removal = sm.removeQueuedMessage(sessionId, 'q1')
    await hydrationStarted
    let invalidationFinished = false
    const invalidation = sm.disposeConnectionRuntimes('test-connection').then(() => {
      invalidationFinished = true
    })
    await Promise.resolve()
    expect(invalidationFinished).toBe(false)

    finishHydration()
    await removal
    await invalidation
    expect(managed.messages.map(message => message.id)).toEqual(['first', 'q2'])
    expect(managed.messageQueue.map(message => message.messageId)).toEqual(['q2'])
    expect(managed.runtimeState).toBeUndefined()
  })
})
