import { afterEach, describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import type { Message, Session } from '../../../shared/types'
import {
  sessionAtomFamily,
  sessionMetaAtomFamily,
  sessionMetaMapAtom,
  sessionIdsAtom,
  loadedSessionsAtom,
  sessionMessagesLoadedAtomFamily,
  ensureSessionMessagesLoadedAtom,
  forceSessionMessagesReloadAtom,
  addSessionAtom,
  refreshSessionsMetadataAtom,
  initializeSessionsAtom,
  replaceLoadedSessionAtom,
  updateSessionAtom,
  updateSessionMetaAtom,
  updateBackgroundTaskProgress,
} from '../sessions'

function msg(id: string, role: Message['role'] = 'user'): Message {
  return {
    id,
    role,
    content: `content:${id}`,
    timestamp: Date.now(),
  }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: overrides.id ?? 'session-1',
    workspaceId: overrides.workspaceId ?? 'workspace-1',
    messages: overrides.messages ?? [],
    permissionMode: overrides.permissionMode ?? 'ask',
    supportsBranching: overrides.supportsBranching ?? true,
    ...overrides,
  } as Session
}

describe('session message loading atoms', () => {
  const originalWindow = globalThis.window

  afterEach(() => {
    if (originalWindow) {
      globalThis.window = originalWindow
    } else {
      // @ts-expect-error test cleanup for window shim
      delete globalThis.window
    }
  })

  it('replaceLoadedSessionAtom marks authoritative full sessions as loaded', () => {
    const store = createStore()
    const sessionId = 'session-1'

    store.set(replaceLoadedSessionAtom, makeSession({
      id: sessionId,
      messages: [msg('m1'), msg('m2', 'assistant')],
    }))

    expect(store.get(loadedSessionsAtom).has(sessionId)).toBe(true)
    expect(store.get(sessionAtomFamily(sessionId))?.messages.map((message) => message.id)).toEqual(['m1', 'm2'])
    expect(store.get(sessionMetaMapAtom).get(sessionId)?.messageCount).toBe(2)
  })

  it('replaceLoadedSessionAtom does not notify metadata subscribers when metadata is unchanged', () => {
    const store = createStore()
    const sessionId = 'session-1'

    store.set(replaceLoadedSessionAtom, makeSession({
      id: sessionId,
      name: 'Same',
      messages: [msg('m1'), msg('m2', 'assistant')],
      lastMessageAt: 100,
    }))
    const beforeMetaMap = store.get(sessionMetaMapAtom)
    let notifications = 0
    const unsubscribe = store.sub(sessionMetaMapAtom, () => {
      notifications += 1
    })

    store.set(replaceLoadedSessionAtom, makeSession({
      id: sessionId,
      name: 'Same',
      messages: [msg('m1'), msg('m2', 'assistant')],
      lastMessageAt: 100,
    }))

    expect(store.get(sessionMetaMapAtom)).toBe(beforeMetaMap)
    expect(notifications).toBe(0)

    unsubscribe()
  })

  it('exposes per-session loaded state without notifying on unrelated sessions', () => {
    const store = createStore()
    const currentLoadedAtom = sessionMessagesLoadedAtomFamily('s1')
    let notifications = 0

    const unsubscribe = store.sub(currentLoadedAtom, () => {
      notifications += 1
    })

    expect(store.get(currentLoadedAtom)).toBe(false)

    store.set(loadedSessionsAtom, new Set(['s2']))
    expect(store.get(currentLoadedAtom)).toBe(false)
    expect(notifications).toBe(0)

    store.set(loadedSessionsAtom, new Set(['s1', 's2']))
    expect(store.get(currentLoadedAtom)).toBe(true)
    expect(notifications).toBe(1)

    store.set(loadedSessionsAtom, new Set(['s1', 's3']))
    expect(store.get(currentLoadedAtom)).toBe(true)
    expect(notifications).toBe(1)

    unsubscribe()
  })

  it('exposes per-session metadata without notifying on unrelated sessions', () => {
    const store = createStore()
    const currentMetaAtom = sessionMetaAtomFamily('s1')
    const currentMeta = {
      id: 's1',
      workspaceId: 'workspace-1',
      name: 'Current',
    }
    let notifications = 0

    store.set(sessionMetaMapAtom, new Map([
      ['s1', currentMeta],
      ['s2', { id: 's2', workspaceId: 'workspace-1', name: 'Other' }],
    ]))

    const unsubscribe = store.sub(currentMetaAtom, () => {
      notifications += 1
    })

    expect(store.get(currentMetaAtom)?.name).toBe('Current')

    store.set(sessionMetaMapAtom, new Map([
      ['s1', currentMeta],
      ['s2', { id: 's2', workspaceId: 'workspace-1', name: 'Other renamed' }],
    ]))
    expect(store.get(currentMetaAtom)?.name).toBe('Current')
    expect(notifications).toBe(0)

    store.set(sessionMetaMapAtom, new Map([
      ['s1', { ...currentMeta, name: 'Current renamed' }],
      ['s2', { id: 's2', workspaceId: 'workspace-1', name: 'Other renamed' }],
    ]))
    expect(store.get(currentMetaAtom)?.name).toBe('Current renamed')
    expect(notifications).toBe(1)

    unsubscribe()
  })

  it('does not notify metadata subscribers when a session update leaves metadata unchanged', () => {
    const store = createStore()
    const sessionId = 's1'
    const session = makeSession({
      id: sessionId,
      messages: [msg('m1', 'assistant')],
      lastMessageAt: 100,
    })
    store.set(replaceLoadedSessionAtom, session)

    let notifications = 0
    const unsubscribe = store.sub(sessionMetaAtomFamily(sessionId), () => {
      notifications += 1
    })

    store.set(updateSessionAtom, sessionId, (prev) => prev && {
      ...prev,
      messages: prev.messages.map((message) => (
        message.id === 'm1' ? { ...message, content: `${message.content}:stream` } : message
      )),
    })

    expect(notifications).toBe(0)
    unsubscribe()
  })

  it('does not notify metadata subscribers when a metadata patch leaves values unchanged', () => {
    const store = createStore()
    const sessionId = 's1'

    store.set(initializeSessionsAtom, [makeSession({ id: sessionId, name: 'Same name' })])
    const before = store.get(sessionMetaMapAtom)

    let notifications = 0
    const unsubscribe = store.sub(sessionMetaMapAtom, () => {
      notifications += 1
    })

    store.set(updateSessionMetaAtom, sessionId, { name: 'Same name' })

    expect(store.get(sessionMetaMapAtom)).toBe(before)
    expect(notifications).toBe(0)
    unsubscribe()
  })

  it('addSessionAtom does not duplicate ids or notify global atoms for the same session', () => {
    const store = createStore()
    const session = makeSession({ id: 's1', name: 'Same', lastMessageAt: 100 })

    store.set(addSessionAtom, session)
    const beforeIds = store.get(sessionIdsAtom)
    const beforeMetaMap = store.get(sessionMetaMapAtom)
    const beforeLoaded = store.get(loadedSessionsAtom)
    let idNotifications = 0
    let metaNotifications = 0
    let loadedNotifications = 0
    const unsubscribeIds = store.sub(sessionIdsAtom, () => {
      idNotifications += 1
    })
    const unsubscribeMeta = store.sub(sessionMetaMapAtom, () => {
      metaNotifications += 1
    })
    const unsubscribeLoaded = store.sub(loadedSessionsAtom, () => {
      loadedNotifications += 1
    })

    store.set(addSessionAtom, makeSession({ id: 's1', name: 'Same', lastMessageAt: 100 }))

    expect(store.get(sessionIdsAtom)).toBe(beforeIds)
    expect(store.get(sessionIdsAtom)).toEqual(['s1'])
    expect(store.get(sessionMetaMapAtom)).toBe(beforeMetaMap)
    expect(store.get(loadedSessionsAtom)).toBe(beforeLoaded)
    expect(idNotifications).toBe(0)
    expect(metaNotifications).toBe(0)
    expect(loadedNotifications).toBe(0)

    unsubscribeIds()
    unsubscribeMeta()
    unsubscribeLoaded()
  })

  it('forceSessionMessagesReloadAtom reloads an empty-but-loaded session', async () => {
    const store = createStore()
    const sessionId = 'session-1'
    const calls: string[] = []

    globalThis.window = {
      electronAPI: {
        getSessionMessages: async (id: string) => {
          calls.push(id)
          return makeSession({
            id,
            messages: [msg('m1'), msg('m2', 'assistant')],
          })
        },
      },
    } as unknown as typeof window

    store.set(sessionAtomFamily(sessionId), makeSession({ id: sessionId, messages: [] }))
    store.set(loadedSessionsAtom, new Set([sessionId]))

    const normalResult = await store.set(ensureSessionMessagesLoadedAtom, sessionId)
    expect(calls).toEqual([])
    expect(normalResult?.messages).toHaveLength(0)

    const forcedResult = await store.set(forceSessionMessagesReloadAtom, sessionId)
    expect(calls).toEqual([sessionId])
    expect(forcedResult?.messages.map((message) => message.id)).toEqual(['m1', 'm2'])
    expect(store.get(sessionAtomFamily(sessionId))?.messages.map((message) => message.id)).toEqual(['m1', 'm2'])
    expect(store.get(loadedSessionsAtom).has(sessionId)).toBe(true)
  })

  it('does not mark stale empty-response fallback as loaded', async () => {
    const store = createStore()
    const sessionId = 'session-1'
    const calls: string[] = []

    globalThis.window = {
      electronAPI: {
        getSessionMessages: async (id: string) => {
          calls.push(id)
          if (calls.length === 1) {
            return makeSession({ id, messages: [] })
          }
          return makeSession({
            id,
            messages: [msg('m1'), msg('m2', 'assistant')],
          })
        },
      },
    } as unknown as typeof window

    store.set(sessionAtomFamily(sessionId), makeSession({
      id: sessionId,
      messages: [msg('local-1'), msg('local-2', 'assistant')],
    }))

    const firstResult = await store.set(ensureSessionMessagesLoadedAtom, sessionId)
    expect(firstResult?.messages.map((message) => message.id)).toEqual(['local-1', 'local-2'])
    expect(store.get(loadedSessionsAtom).has(sessionId)).toBe(false)

    const secondResult = await store.set(forceSessionMessagesReloadAtom, sessionId)
    expect(calls).toEqual([sessionId, sessionId])
    expect(secondResult?.messages.map((message) => message.id)).toEqual(['m1', 'm2'])
    expect(store.get(loadedSessionsAtom).has(sessionId)).toBe(true)
  })
})

describe('background task atoms', () => {
  it('keeps the original task list when progress seconds do not change', () => {
    const tasks = [{
      id: 'task-1',
      type: 'agent' as const,
      toolUseId: 'tool-1',
      startTime: 1,
      elapsedSeconds: 12,
    }]

    expect(updateBackgroundTaskProgress(tasks, 'tool-1', 12)).toBe(tasks)
    expect(updateBackgroundTaskProgress(tasks, 'tool-1', 13)).toEqual([
      { ...tasks[0], elapsedSeconds: 13 },
    ])
  })
})

describe('refreshSessionsMetadataAtom', () => {
  it('preserves messages for already-loaded sessions', () => {
    const store = createStore()
    const existingMessages = [msg('m1'), msg('m2', 'assistant')]

    // Pre-populate: session has messages and is marked loaded
    store.set(sessionAtomFamily('s1'), makeSession({ id: 's1', messages: existingMessages }))
    store.set(loadedSessionsAtom, new Set(['s1']))

    // Refresh with metadata-only payload (empty messages, like getSessions returns)
    const freshSessions = [makeSession({ id: 's1', messages: [] })]
    store.set(refreshSessionsMetadataAtom, {
      sessions: freshSessions,
      loadedSessionIds: new Set(['s1']),
    })

    // Messages should be preserved from the existing atom
    const session = store.get(sessionAtomFamily('s1'))
    expect(session?.messages.map(m => m.id)).toEqual(['m1', 'm2'])
  })

  it('marks sessions as unloaded when atom was cleared but loadedSessionIds still tracked them', () => {
    const store = createStore()

    // Session was previously loaded, but its atom was cleared (e.g., by remove + re-add)
    // while loadedSessionsAtom still tracks it. The atom value is null.
    store.set(loadedSessionsAtom, new Set(['s1']))
    // sessionAtomFamily('s1') defaults to null — no store.set needed

    // Refresh — s1 is in loadedSessionIds but current atom is null,
    // so shouldPreserveMessages is false. Since it was in loadedSessionIds,
    // it should be removed so lazy-loading re-fetches messages.
    const freshSessions = [makeSession({ id: 's1', messages: [] })]
    store.set(refreshSessionsMetadataAtom, {
      sessions: freshSessions,
      loadedSessionIds: new Set(['s1']),
    })

    expect(store.get(loadedSessionsAtom).has('s1')).toBe(false)
  })

  it('removes stale sessions from all atoms', () => {
    const store = createStore()

    // Initialize with two sessions via initializeSessionsAtom
    store.set(initializeSessionsAtom, [
      makeSession({ id: 's1' }),
      makeSession({ id: 's2' }),
    ])
    expect(store.get(sessionMetaMapAtom).size).toBe(2)
    expect(store.get(sessionIdsAtom)).toContain('s2')

    // Refresh with only s1 — s2 should be removed
    store.set(refreshSessionsMetadataAtom, {
      sessions: [makeSession({ id: 's1' })],
      loadedSessionIds: new Set<string>(),
    })

    expect(store.get(sessionMetaMapAtom).has('s2')).toBe(false)
    expect(store.get(sessionIdsAtom)).not.toContain('s2')
    expect(store.get(sessionAtomFamily('s2'))).toBe(null)
  })

  it('preserves omitted sessions when removeMissing is false', () => {
    const store = createStore()

    store.set(initializeSessionsAtom, [
      makeSession({ id: 's1', name: 'First', lastMessageAt: 200 }),
      makeSession({ id: 's2', name: 'Second', lastMessageAt: 100 }),
    ])

    const result = store.set(refreshSessionsMetadataAtom, {
      sessions: [makeSession({ id: 's1', name: 'First refreshed', lastMessageAt: 300 })],
      loadedSessionIds: new Set<string>(),
      removeMissing: false,
    })

    expect(result.has('s1')).toBe(true)
    expect(result.has('s2')).toBe(true)
    expect(result.get('s1')?.name).toBe('First refreshed')
    expect(result.get('s2')?.name).toBe('Second')

    const storeMap = store.get(sessionMetaMapAtom)
    expect(storeMap.has('s2')).toBe(true)
    expect(store.get(sessionIdsAtom)).toEqual(['s1', 's2'])
    expect(store.get(sessionAtomFamily('s2'))?.name).toBe('Second')
  })

  it('non-destructive refresh still preserves loaded messages for returned sessions', () => {
    const store = createStore()
    const existingMessages = [msg('m1'), msg('m2', 'assistant')]

    store.set(initializeSessionsAtom, [
      makeSession({ id: 's1', name: 'First', messages: [] }),
      makeSession({ id: 's2', name: 'Second', messages: [] }),
    ])
    store.set(sessionAtomFamily('s1'), makeSession({ id: 's1', name: 'First', messages: existingMessages }))
    store.set(loadedSessionsAtom, new Set(['s1']))

    store.set(refreshSessionsMetadataAtom, {
      sessions: [makeSession({ id: 's1', name: 'First refreshed', messages: [] })],
      loadedSessionIds: new Set(['s1']),
      removeMissing: false,
    })

    expect(store.get(sessionAtomFamily('s1'))?.messages.map(m => m.id)).toEqual(['m1', 'm2'])
    expect(store.get(sessionMetaMapAtom).get('s1')?.name).toBe('First refreshed')
    expect(store.get(sessionMetaMapAtom).get('s2')?.name).toBe('Second')
  })

  it('updates metadata map and returns it', () => {
    const store = createStore()

    const sessions = [
      makeSession({ id: 's1', name: 'First' }),
      makeSession({ id: 's2', name: 'Second' }),
    ]

    const result = store.set(refreshSessionsMetadataAtom, {
      sessions,
      loadedSessionIds: new Set<string>(),
    })

    // Returned map matches store state
    expect(result.size).toBe(2)
    expect(result.get('s1')?.name).toBe('First')
    expect(result.get('s2')?.name).toBe('Second')

    // Store is consistent
    const storeMap = store.get(sessionMetaMapAtom)
    expect(storeMap.size).toBe(2)
    expect(storeMap.get('s1')?.name).toBe('First')

    // IDs are set
    expect(store.get(sessionIdsAtom)).toHaveLength(2)
  })

  it('does not notify metadata or id subscribers when refresh metadata is unchanged', () => {
    const store = createStore()
    const sessions = [
      makeSession({ id: 's1', name: 'First', lastMessageAt: 200 }),
      makeSession({ id: 's2', name: 'Second', lastMessageAt: 100 }),
    ]

    store.set(refreshSessionsMetadataAtom, {
      sessions,
      loadedSessionIds: new Set<string>(),
    })
    const beforeMetaMap = store.get(sessionMetaMapAtom)
    const beforeIds = store.get(sessionIdsAtom)
    let metaNotifications = 0
    let idNotifications = 0
    const unsubscribeMeta = store.sub(sessionMetaMapAtom, () => {
      metaNotifications += 1
    })
    const unsubscribeIds = store.sub(sessionIdsAtom, () => {
      idNotifications += 1
    })

    store.set(refreshSessionsMetadataAtom, {
      sessions: [
        makeSession({ id: 's1', name: 'First', lastMessageAt: 200 }),
        makeSession({ id: 's2', name: 'Second', lastMessageAt: 100 }),
      ],
      loadedSessionIds: new Set<string>(),
    })

    expect(store.get(sessionMetaMapAtom)).toBe(beforeMetaMap)
    expect(store.get(sessionIdsAtom)).toBe(beforeIds)
    expect(metaNotifications).toBe(0)
    expect(idNotifications).toBe(0)

    unsubscribeMeta()
    unsubscribeIds()
  })
})
