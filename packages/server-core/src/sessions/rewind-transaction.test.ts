// input: SessionManager product messages, queue state, and rewind phase requests
// output: Regression coverage for rewind CAS and non-destructive manual rejection
// pos: Guards the product-side half of the Pi-owned rewind transaction

import { expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ConversationRewindRequest,
  ConversationRewindResult,
} from '@craft-agent/shared/agent/backend/types'
import { SessionManager, createManagedSession } from './SessionManager.ts'

function createHarness() {
  const rootPath = mkdtempSync(join(tmpdir(), 'rewind-transaction-'))
  const manager = new SessionManager()
  const managed = createManagedSession(
    { id: 'rewind-session', name: 'rewind test' },
    {
      id: 'rewind-workspace',
      name: 'Rewind Workspace',
      rootPath,
      createdAt: Date.now(),
    } as never,
    { messagesLoaded: true },
  )
  managed.messages = [
    { id: 'user-1', role: 'user', content: 'first', timestamp: 1 },
    { id: 'assistant-1', role: 'assistant', content: 'answer', timestamp: 2 },
    { id: 'user-2', role: 'user', content: 'second', timestamp: 3 },
  ]
  ;(manager as unknown as { sessions: Map<string, unknown> }).sessions.set(managed.id, managed)
  const handle = (request: ConversationRewindRequest) => (
    manager as unknown as {
      handleConversationRewind: (
        session: typeof managed,
        request: ConversationRewindRequest,
      ) => Promise<ConversationRewindResult>
    }
  ).handleConversationRewind(managed, request)
  return { rootPath, manager, managed, handle }
}

it('rejects a stale rewind reservation without deleting a newly queued message', async () => {
  const { rootPath, managed, handle } = createHarness()
  try {
    const prepared = await handle({
      phase: 'prepare',
      boundary: { retainThroughMessageId: 'assistant-1' },
    })
    if (prepared.phase !== 'prepared') throw new Error('rewind was not prepared')

    managed.messageQueue.push({ message: 'queued after prepare', messageId: 'queued-1' })

    await expect(handle({
      phase: 'commit',
      token: prepared.token,
      expectedRevision: prepared.revision,
    })).rejects.toThrow('Conversation changed after rewind was prepared')
    expect(managed.messages.map(message => message.id)).toEqual(['user-1', 'assistant-1', 'user-2'])
    expect(managed.messageQueue.map(entry => entry.messageId)).toEqual(['queued-1'])
  } finally {
    rmSync(rootPath, { recursive: true, force: true })
  }
})

it('manual rewind refuses active work without clearing the queue', async () => {
  const { rootPath, manager, managed } = createHarness()
  try {
    managed.isProcessing = true
    managed.messageQueue.push({ message: 'keep me', messageId: 'queued-1' })

    await expect(manager.rewindUserMessage(managed.id, 'user-2'))
      .rejects.toThrow('Cannot rewind while this conversation is processing or has queued messages')
    expect(managed.messageQueue.map(entry => entry.messageId)).toEqual(['queued-1'])
    expect(managed.messages.map(message => message.id)).toEqual(['user-1', 'assistant-1', 'user-2'])
  } finally {
    rmSync(rootPath, { recursive: true, force: true })
  }
})
