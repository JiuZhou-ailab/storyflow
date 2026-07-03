import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import {
  messagingBindingsAtom,
  messagingBindingsForSessionAtomFamily,
  type MessagingBinding,
} from '../messaging'

function binding(overrides: Partial<MessagingBinding> = {}): MessagingBinding {
  return {
    id: overrides.id ?? 'binding-1',
    workspaceId: overrides.workspaceId ?? 'workspace-1',
    sessionId: overrides.sessionId ?? 'session-1',
    platform: overrides.platform ?? 'telegram',
    channelId: overrides.channelId ?? 'channel-1',
    channelName: overrides.channelName,
    enabled: overrides.enabled ?? true,
    createdAt: overrides.createdAt ?? 1,
    accessMode: overrides.accessMode,
    allowedSenderIds: overrides.allowedSenderIds,
    threadId: overrides.threadId,
  }
}

describe('messaging binding atoms', () => {
  it('exposes per-session bindings without notifying on unrelated sessions', () => {
    const store = createStore()
    const currentBindingsAtom = messagingBindingsForSessionAtomFamily('session-1')
    let notifications = 0

    store.set(messagingBindingsAtom, [
      binding({ id: 'binding-1', sessionId: 'session-1' }),
      binding({ id: 'binding-2', sessionId: 'session-2' }),
    ])

    const unsubscribe = store.sub(currentBindingsAtom, () => {
      notifications += 1
    })

    expect(store.get(currentBindingsAtom).map((item) => item.id)).toEqual(['binding-1'])

    store.set(messagingBindingsAtom, [
      binding({ id: 'binding-1', sessionId: 'session-1' }),
      binding({ id: 'binding-2', sessionId: 'session-2', channelName: 'Renamed' }),
    ])
    expect(store.get(currentBindingsAtom).map((item) => item.id)).toEqual(['binding-1'])
    expect(notifications).toBe(0)

    store.set(messagingBindingsAtom, [
      binding({ id: 'binding-1', sessionId: 'session-1', channelName: 'Current renamed' }),
      binding({ id: 'binding-2', sessionId: 'session-2', channelName: 'Renamed' }),
    ])
    expect(store.get(currentBindingsAtom).map((item) => item.channelName)).toEqual(['Current renamed'])
    expect(notifications).toBe(1)

    unsubscribe()
  })
})
