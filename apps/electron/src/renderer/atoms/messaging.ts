/**
 * Messaging Gateway Atoms
 *
 * Workspace-level state for messaging bindings.
 * Populated by subscribing to messaging:bindingChanged push events.
 */

import { atom } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { atomFamily } from 'jotai-family'

export interface MessagingBinding {
  id: string
  workspaceId: string
  sessionId: string
  platform: string
  channelId: string
  /** Telegram supergroup forum topic id; undefined for DMs / non-Telegram. */
  threadId?: number
  channelName?: string
  enabled: boolean
  createdAt: number
  /**
   * Per-binding access policy. Optional in the wire shape so legacy bindings
   * (created before access control existed) don't break atom updates. The
   * UI treats missing values as `'open'`.
   */
  accessMode?: 'inherit' | 'allow-list' | 'open'
  allowedSenderIds?: string[]
}

export const messagingBindingsAtom = atom<MessagingBinding[]>([])

export const messagingBindingsBySessionAtom = atom((get) => {
  const map = new Map<string, MessagingBinding[]>()
  for (const binding of get(messagingBindingsAtom)) {
    if (!binding.enabled) continue
    const list = map.get(binding.sessionId)
    if (list) {
      list.push(binding)
    } else {
      map.set(binding.sessionId, [binding])
    }
  }
  return map
})

export const messagingBindingsByPlatformAtom = atom((get) => {
  const map = new Map<string, MessagingBinding[]>()
  for (const binding of get(messagingBindingsAtom)) {
    const list = map.get(binding.platform)
    if (list) {
      list.push(binding)
    } else {
      map.set(binding.platform, [binding])
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => b.createdAt - a.createdAt)
  }
  return map
})

export const hasOpenTelegramBindingAtom = selectAtom(
  messagingBindingsAtom,
  (bindings) => bindings.some((binding) => binding.platform === 'telegram' && binding.accessMode === 'open'),
  Object.is,
)

function messagingBindingsEqual(a: MessagingBinding[], b: MessagingBinding[]): boolean {
  if (a.length !== b.length) return false
  return a.every((binding, index) => {
    const other = b[index]
    return !!other
      && binding.id === other.id
      && binding.workspaceId === other.workspaceId
      && binding.sessionId === other.sessionId
      && binding.platform === other.platform
      && binding.channelId === other.channelId
      && binding.threadId === other.threadId
      && binding.channelName === other.channelName
      && binding.enabled === other.enabled
      && binding.createdAt === other.createdAt
      && binding.accessMode === other.accessMode
      && binding.allowedSenderIds?.join('\0') === other.allowedSenderIds?.join('\0')
  })
}

export const messagingBindingsForSessionAtomFamily = atomFamily(
  (sessionId: string) => selectAtom(
    messagingBindingsBySessionAtom,
    (bindingsBySession) => bindingsBySession.get(sessionId) ?? [],
    messagingBindingsEqual,
  ),
  (a, b) => a === b,
)

export const messagingBindingsForPlatformAtomFamily = atomFamily(
  (platform: string) => selectAtom(
    messagingBindingsByPlatformAtom,
    (bindingsByPlatform) => bindingsByPlatform.get(platform) ?? [],
    messagingBindingsEqual,
  ),
  (a, b) => a === b,
)

export const setMessagingBindingsAtom = atom(
  null,
  (get, set, bindings: MessagingBinding[]) => {
    const next = bindings.filter((binding) => binding.enabled)
    if (messagingBindingsEqual(get(messagingBindingsAtom), next)) return
    set(messagingBindingsAtom, next)
  },
)

/**
 * Global messaging dialog state.
 *
 * Hoisted out of SessionMenu so dialogs survive context-menu / dropdown close.
 * Rendered by <MessagingDialogHost /> mounted at AppShell level.
 */
export type MessagingDialogState =
  | { kind: 'closed' }
  | {
      kind: 'pairing'
      platform: 'telegram' | 'whatsapp' | 'lark'
      sessionId: string
      code: string | null
      expiresAt: number | null
      botUsername?: string
      error?: string
    }
  | {
      kind: 'wa_connect'
      continueToPairingSessionId?: string
    }

export const messagingDialogAtom = atom<MessagingDialogState>({ kind: 'closed' })
