// input: Session messages and parent session execution settings
// output: Rewind branch target resolution and branch session options
// pos: Pure helper layer for editing historical user messages without mutating history

import type { CreateSessionOptions, Message } from '../../../shared/types'
import { MANAGED_LLM_CONNECTION_SLUG } from '@config/llm-connections'
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
> & {
  messages: Array<Pick<Message, 'id' | 'role' | 'isIntermediate' | 'turnId' | 'canBranch'>>
}

export const MANAGED_DEFAULT_CONNECTION_SLUG = MANAGED_LLM_CONNECTION_SLUG

export function canCreateDefaultRewindBranch(
  session: Pick<RewindSourceSession, 'llmConnection'>,
  branchFromMessageId: string | null,
  defaultConnectionSlug: string | null | undefined
): boolean {
  if (!branchFromMessageId) return true
  if (!session.llmConnection || !defaultConnectionSlug) return true
  return session.llmConnection === defaultConnectionSlug
}

export function canRewindWithoutDroppingHistory(
  session: RewindSourceSession,
  userMessageId: string,
  branchFromMessageId: string | null
): boolean {
  return !!branchFromMessageId
    || session.messages.find(message => message.role === 'user')?.id === userMessageId
}

export function resolveRewindBranchMessageId(
  messages: RewindSourceSession['messages'],
  userMessageId: string
): string | null {
  const index = messages.findIndex(message => message.id === userMessageId)
  if (index <= 0) return null
  for (let i = index - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role === 'assistant' && !message.isIntermediate && message.turnId && message.canBranch !== false) {
      return message.id
    }
  }
  return null
}

export function buildRewindSessionOptions(
  session: RewindSourceSession,
  branchFromMessageId: string | null
): CreateSessionOptions {
  const options: CreateSessionOptions = {
    name: `Rewind of ${session.name || 'Untitled'}`,
    ...(session.llmConnection ? { llmConnection: session.llmConnection } : {}),
    ...(session.model ? { model: session.model } : {}),
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
