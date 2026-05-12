import { describe, expect, it } from 'bun:test'
import {
  buildRewindSessionOptions,
  resolveRewindBranchMessageId,
} from '../chat-rewind'

const baseMessages: Parameters<typeof resolveRewindBranchMessageId>[0] = [
  { id: 'u1', role: 'user' },
  { id: 'a1', role: 'assistant' },
  { id: 'u2', role: 'user' },
]

const baseSession = {
  id: 'session-1',
  workspaceId: 'workspace-1',
  name: 'Planning',
  llmConnection: 'pi',
  model: 'glm-5.1',
  permissionMode: 'ask' as const,
  workingDirectory: '/repo',
  enabledSourceSlugs: ['docs'],
  messages: baseMessages,
}

describe('chat rewind helpers', () => {
  it('branches from the message before the edited user message', () => {
    expect(resolveRewindBranchMessageId(baseSession.messages, 'u2')).toBe('a1')
  })

  it('skips non-final messages when resolving the rewind branch point', () => {
    expect(resolveRewindBranchMessageId([
      { id: 'u1', role: 'user' },
      { id: 'a1', role: 'assistant' },
      { id: 't1', role: 'tool' },
      { id: 'a2', role: 'assistant', isIntermediate: true },
      { id: 'u2', role: 'user' },
    ], 'u2')).toBe('a1')
  })

  it('uses a fresh session when editing the first user message', () => {
    expect(resolveRewindBranchMessageId(baseSession.messages, 'u1')).toBeNull()
  })

  it('preserves session execution options when creating a rewind branch', () => {
    expect(buildRewindSessionOptions(baseSession, 'a1')).toEqual({
      name: 'Rewind of Planning',
      branchFromMessageId: 'a1',
      branchFromSessionId: 'session-1',
      llmConnection: 'pi',
      model: 'glm-5.1',
      permissionMode: 'ask',
      workingDirectory: '/repo',
      enabledSourceSlugs: ['docs'],
    })
  })
})
