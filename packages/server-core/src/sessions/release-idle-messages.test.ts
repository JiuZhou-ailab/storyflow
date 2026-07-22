// input: SessionManager with hydrated idle sessions and disk-backed jsonl
// output: Regression for main-process transcript release working-set dual
// pos: Complements renderer unloadSessionTranscriptAtom without disk wipe risk

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  getSessionFilePath,
  writeSessionJsonl,
  type StoredSession,
} from '@craft-agent/shared/sessions'
import type { StoredMessage } from '@craft-agent/core/types'
import { SessionManager, createManagedSession } from './SessionManager.ts'

describe('releaseIdleSessionMessages', () => {
  let tmpRoot: string
  let sm: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-release-msgs-'))
    sm = new SessionManager()
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function buildWorkspace() {
    return {
      id: 'ws_test',
      name: 'Test Workspace',
      rootPath: tmpRoot,
      createdAt: Date.now(),
    } as never
  }

  function seedSession(sessionId: string, messages: StoredMessage[]) {
    const filePath = getSessionFilePath(tmpRoot, sessionId)
    mkdirSync(dirname(filePath), { recursive: true })
    const stored: StoredSession = {
      id: sessionId,
      workspaceRootPath: tmpRoot,
      name: 'release target',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      messages,
    } as StoredSession
    writeSessionJsonl(filePath, stored)

    const managed = createManagedSession(
      {
        id: sessionId,
        name: stored.name,
        createdAt: stored.createdAt,
      },
      buildWorkspace(),
    )
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(sessionId, managed)
  }

  function readDiskMessageIds(sessionId: string): string[] {
    const path = getSessionFilePath(tmpRoot, sessionId)
    const lines = readFileSync(path, 'utf-8').trim().split('\n').slice(1)
    return lines.map(l => JSON.parse(l)).map(m => m.id as string)
  }

  it('drops in-memory messages for idle hydrated sessions and reloads from disk later', async () => {
    const sessionId = 'sess-idle'
    seedSession(sessionId, [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'hello', timestamp: 2 },
    ] as unknown as StoredMessage[])

    const loaded = await sm.getSession(sessionId)
    expect(loaded?.messages).toHaveLength(2)

    const released = await sm.releaseIdleSessionMessages(sessionId)
    expect(released).toBe(true)

    const managed = (sm as unknown as { sessions: Map<string, { messages: unknown[]; messagesLoaded: boolean }> })
      .sessions.get(sessionId)!
    expect(managed.messagesLoaded).toBe(false)
    expect(managed.messages).toEqual([])
    // Disk untouched
    expect(readDiskMessageIds(sessionId)).toEqual(['u1', 'a1'])

    const reloaded = await sm.getSession(sessionId)
    expect(reloaded?.messages.map(m => m.id)).toEqual(['u1', 'a1'])
  })

  it('refuses to release while the session is processing', async () => {
    const sessionId = 'sess-busy'
    seedSession(sessionId, [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
    ] as unknown as StoredMessage[])
    await sm.getSession(sessionId)

    const managed = (sm as unknown as { sessions: Map<string, { isProcessing: boolean }> })
      .sessions.get(sessionId)!
    managed.isProcessing = true

    expect(await sm.releaseIdleSessionMessages(sessionId)).toBe(false)
    const after = await sm.getSession(sessionId)
    expect(after?.messages).toHaveLength(1)
  })

  it('is a no-op success when messages were never loaded', async () => {
    const sessionId = 'sess-cold'
    seedSession(sessionId, [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
    ] as unknown as StoredMessage[])

    expect(await sm.releaseIdleSessionMessages(sessionId)).toBe(true)
    const managed = (sm as unknown as { sessions: Map<string, { messagesLoaded: boolean }> })
      .sessions.get(sessionId)!
    expect(managed.messagesLoaded).toBe(false)
  })
})
