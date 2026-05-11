// input: Session messages and parent session execution settings
// output: Rewind branch target resolution and branch session options
// pos: Pure helper layer for editing historical user messages without mutating history

import type { CreateSessionOptions, Message } from '../../../shared/types'
import type { Session } from '@craft-agent/shared/protocol'

type RewindSourceSession = Pick<
  Session,
  | 'id'
  | 'name'
  | 'llmConnection'
  | 'model'
  | 'permissionMode'
  | 'workingDirectory'
  | 'enabledSourceSlugs'
>

export function resolveRewindBranchMessageId(
  messages: Array<Pick<Message, 'id'>>,
  userMessageId: string
): string | null {
  const index = messages.findIndex(message => message.id === userMessageId)
  if (index <= 0) return null
  return messages[index - 1]?.id ?? null
}

export function buildRewindSessionOptions(
  session: RewindSourceSession,
  branchFromMessageId: string | null
): CreateSessionOptions {
  const options: CreateSessionOptions = {
    name: `Rewind of ${session.name || 'Untitled'}`,
    llmConnection: session.llmConnection,
    model: session.model,
    permissionMode: session.permissionMode,
    workingDirectory: session.workingDirectory,
    enabledSourceSlugs: session.enabledSourceSlugs,
  }

  if (branchFromMessageId) {
    options.branchFromMessageId = branchFromMessageId
    options.branchFromSessionId = session.id
  }

  return options
}
