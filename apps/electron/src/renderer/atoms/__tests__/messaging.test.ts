import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import {
  hasOpenTelegramBindingAtom,
  messagingBindingsAtom,
  messagingBindingsForPlatformAtomFamily,
  messagingBindingsForSessionAtomFamily,
  setMessagingBindingsAtom,
  type MessagingBinding,
} from '../messaging'

const messagingSource = readFileSync(
  fileURLToPath(new URL('../messaging.ts', import.meta.url)),
  'utf-8'
)

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
  it('exposes open Telegram binding state without notifying on unrelated binding updates', () => {
    const store = createStore()
    let notifications = 0

    store.set(messagingBindingsAtom, [
      binding({ id: 'binding-1', platform: 'telegram', accessMode: 'open' }),
      binding({ id: 'binding-2', platform: 'whatsapp', accessMode: 'allow-list' }),
    ])

    const unsubscribe = store.sub(hasOpenTelegramBindingAtom, () => {
      notifications += 1
    })

    expect(store.get(hasOpenTelegramBindingAtom)).toBe(true)

    store.set(messagingBindingsAtom, [
      binding({ id: 'binding-1', platform: 'telegram', accessMode: 'open' }),
      binding({ id: 'binding-2', platform: 'whatsapp', accessMode: 'open' }),
    ])
    expect(store.get(hasOpenTelegramBindingAtom)).toBe(true)
    expect(notifications).toBe(0)

    store.set(messagingBindingsAtom, [
      binding({ id: 'binding-1', platform: 'telegram', accessMode: 'allow-list' }),
      binding({ id: 'binding-2', platform: 'whatsapp', accessMode: 'open' }),
    ])
    expect(store.get(hasOpenTelegramBindingAtom)).toBe(false)
    expect(notifications).toBe(1)

    unsubscribe()
  })

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

  it('derives per-session bindings from the session-indexed map', () => {
    expect(messagingSource).toContain('selectAtom(\n    messagingBindingsBySessionAtom')
    expect(messagingSource).toContain('bindingsBySession.get(sessionId)')
    expect(messagingSource).not.toContain('bindings.filter((binding) => binding.enabled && binding.sessionId === sessionId)')
  })

  it('exposes newest-first per-platform bindings without notifying on unrelated platforms', () => {
    const store = createStore()
    const telegramBindingsAtom = messagingBindingsForPlatformAtomFamily('telegram')
    let notifications = 0

    store.set(messagingBindingsAtom, [
      binding({ id: 'telegram-old', platform: 'telegram', createdAt: 10 }),
      binding({ id: 'whatsapp-1', platform: 'whatsapp', createdAt: 30 }),
      binding({ id: 'telegram-new', platform: 'telegram', createdAt: 20 }),
    ])

    const unsubscribe = store.sub(telegramBindingsAtom, () => {
      notifications += 1
    })

    expect(store.get(telegramBindingsAtom).map((item) => item.id)).toEqual(['telegram-new', 'telegram-old'])

    store.set(messagingBindingsAtom, [
      binding({ id: 'telegram-old', platform: 'telegram', createdAt: 10 }),
      binding({ id: 'whatsapp-1', platform: 'whatsapp', createdAt: 35 }),
      binding({ id: 'telegram-new', platform: 'telegram', createdAt: 20 }),
    ])
    expect(store.get(telegramBindingsAtom).map((item) => item.id)).toEqual(['telegram-new', 'telegram-old'])
    expect(notifications).toBe(0)

    store.set(messagingBindingsAtom, [
      binding({ id: 'telegram-old', platform: 'telegram', createdAt: 10 }),
      binding({ id: 'whatsapp-1', platform: 'whatsapp', createdAt: 35 }),
      binding({ id: 'telegram-new', platform: 'telegram', createdAt: 21 }),
    ])
    expect(store.get(telegramBindingsAtom).map((item) => item.createdAt)).toEqual([21, 10])
    expect(notifications).toBe(1)

    store.set(messagingBindingsAtom, [
      binding({ id: 'telegram-old', platform: 'telegram', createdAt: 25 }),
      binding({ id: 'whatsapp-1', platform: 'whatsapp', createdAt: 35 }),
      binding({ id: 'telegram-new', platform: 'telegram', createdAt: 20 }),
    ])
    expect(store.get(telegramBindingsAtom).map((item) => item.id)).toEqual(['telegram-old', 'telegram-new'])
    expect(notifications).toBe(2)

    unsubscribe()
  })

  it('does not notify binding subscribers when filtered bindings are unchanged', () => {
    const store = createStore()

    store.set(setMessagingBindingsAtom, [
      binding({ id: 'binding-1' }),
      binding({ id: 'binding-disabled', enabled: false }),
    ])
    const before = store.get(messagingBindingsAtom)
    let notifications = 0
    const unsubscribe = store.sub(messagingBindingsAtom, () => {
      notifications += 1
    })

    store.set(setMessagingBindingsAtom, [
      binding({ id: 'binding-1' }),
      binding({ id: 'binding-disabled', enabled: false }),
    ])

    expect(store.get(messagingBindingsAtom)).toBe(before)
    expect(notifications).toBe(0)

    unsubscribe()
  })
})
