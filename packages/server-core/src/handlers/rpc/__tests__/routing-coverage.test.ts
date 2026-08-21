// input: REMOTE_ELIGIBLE contract from @craft-agent/shared/protocol plus domain registrar channel constants
// output: Assertions that every remote-eligible channel is answerable by server-core
// pos: Routing coverage guard — a remote workspace server must answer everything routed to it

import { describe, expect, test } from 'bun:test'
import { RPC_CHANNELS, REMOTE_ELIGIBLE_CHANNELS } from '@craft-agent/shared/protocol'

import { HANDLED_CHANNELS as auth } from '../auth'
import { HANDLED_CHANNELS as automations } from '../automations'
import { HANDLED_CHANNELS as files } from '../files'
import { HANDLED_CHANNELS as labels } from '../labels'
import { HANDLED_CHANNELS as llmConnections } from '../llm-connections'
import { HANDLED_CHANNELS as messaging } from '../messaging'
import { HANDLED_CHANNELS as oauth } from '../oauth'
import { HANDLED_CHANNELS as onboarding } from '../onboarding'
import { HANDLED_CHANNELS as resources } from '../resources'
import { HANDLED_CHANNELS as search } from '../search'
import { HANDLED_CHANNELS as server } from '../server'
import { HANDLED_CHANNELS as sessions } from '../sessions'
import { HANDLED_CHANNELS as settings } from '../settings'
import { HANDLED_CHANNELS as skills } from '../skills'
import { HANDLED_CHANNELS as sources } from '../sources'
import { HANDLED_CHANNELS as statuses } from '../statuses'
import { CORE_HANDLED_CHANNELS as system } from '../system'
import { HANDLED_CHANNELS as transfer } from '../transfer'
import { CORE_HANDLED_CHANNELS as workspace } from '../workspace'
import { WORKSPACE_FILE_MUTATION_CHANNELS as workspaceFileMutations } from '../workspace-file-mutations'

/** Every channel some server-core registrar answers via server.handle(). */
const SERVER_CORE_HANDLED: ReadonlySet<string> = new Set([
  ...auth,
  ...automations,
  ...files,
  ...labels,
  ...llmConnections,
  ...messaging,
  ...oauth,
  ...onboarding,
  ...resources,
  ...search,
  ...server,
  ...sessions,
  ...settings,
  ...skills,
  ...sources,
  ...statuses,
  ...system,
  ...transfer,
  ...workspace,
  ...workspaceFileMutations,
])

/**
 * REMOTE_ELIGIBLE channels with no `server.handle()` registration.
 *
 * Push/broadcast channels are emitted by the server (never invoked by clients),
 * so they need no handler; forward-declared channels await their implementing
 * adapter. Removing an entry requires wiring a real handler first; adding one
 * requires a comment explaining why the channel is still unhandled.
 */
const EXEMPT_REMOTE_CHANNELS: readonly string[] = [
  // Server → client broadcasts pushed by server-core / messaging-gateway:
  RPC_CHANNELS.llmConnections.CHANGED,
  RPC_CHANNELS.automations.CHANGED,
  RPC_CHANNELS.labels.CHANGED,
  RPC_CHANNELS.skills.CHANGED,
  RPC_CHANNELS.sources.CHANGED,
  RPC_CHANNELS.statuses.CHANGED,
  RPC_CHANNELS.permissions.DEFAULTS_CHANGED,
  RPC_CHANNELS.server.SHUTTING_DOWN,
  RPC_CHANNELS.server.STATUS_CHANGED,
  RPC_CHANNELS.sessions.EVENT,
  RPC_CHANNELS.sessions.FILES_CHANGED,
  RPC_CHANNELS.sessions.UNREAD_SUMMARY_CHANGED,
  RPC_CHANNELS.onboarding.CLAUDE_OAUTH_COMPLETED,
  RPC_CHANNELS.copilot.DEVICE_CODE,
  RPC_CHANNELS.messaging.BINDING_CHANGED,
  RPC_CHANNELS.messaging.PENDING_CHANGED,
  RPC_CHANNELS.messaging.PLATFORM_STATUS,
  RPC_CHANNELS.messaging.WA_UI_EVENT,
  // WhatsApp subprocess ↔ gateway protocol, declared ahead of the Baileys
  // subprocess adapter — no handler exists anywhere yet:
  RPC_CHANNELS.messaging.WA_REGISTER,
  RPC_CHANNELS.messaging.WA_INCOMING,
  RPC_CHANNELS.messaging.WA_BUTTON_PRESS,
  RPC_CHANNELS.messaging.WA_STATUS,
  RPC_CHANNELS.messaging.WA_QR,
  RPC_CHANNELS.messaging.WA_SEND,
  RPC_CHANNELS.messaging.WA_SEND_BUTTONS,
  RPC_CHANNELS.messaging.WA_SEND_TYPING,
  RPC_CHANNELS.messaging.WA_SEND_FILE,
  RPC_CHANNELS.messaging.WA_CONNECT,
  RPC_CHANNELS.messaging.WA_DISCONNECT,
]

describe('remote routing coverage', () => {
  test('every REMOTE_ELIGIBLE channel is handled by server-core or explicitly exempted', () => {
    const gaps = [...REMOTE_ELIGIBLE_CHANNELS].filter(
      ch => !SERVER_CORE_HANDLED.has(ch) && !EXEMPT_REMOTE_CHANNELS.includes(ch),
    )
    expect(gaps).toEqual([])
  })

  test('exemptions stay honest: remote-eligible and genuinely unhandled', () => {
    for (const ch of EXEMPT_REMOTE_CHANNELS) {
      expect(REMOTE_ELIGIBLE_CHANNELS.has(ch)).toBe(true)
      expect(SERVER_CORE_HANDLED.has(ch)).toBe(false)
    }
  })
})
