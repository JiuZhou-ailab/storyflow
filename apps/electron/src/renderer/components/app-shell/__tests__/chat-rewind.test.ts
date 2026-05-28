// input: Chat transcript snippets around user messages
// output: Regression checks for rewind branch target selection and session option cloning
// pos: Guards edit-and-regenerate branching behavior in the app shell

import { describe, expect, it } from 'bun:test'
import {
  buildRewindSessionOptions,
  canCreateDefaultRewindBranch,
  MANAGED_DEFAULT_CONNECTION_SLUG,
  resolveRewindBranchMessageId,
} from '../chat-rewind'

const baseMessages: Parameters<typeof resolveRewindBranchMessageId>[0] = [
  { id: 'u1', role: 'user' },
  { id: 'a1', role: 'assistant', turnId: 'turn-a1' },
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
      { id: 'a1', role: 'assistant', turnId: 'turn-a1' },
      { id: 't1', role: 'tool' },
      { id: 'a2', role: 'assistant', isIntermediate: true },
      { id: 'u2', role: 'user' },
    ], 'u2')).toBe('a1')
  })

  it('uses a fresh session when the previous assistant message is local-only', () => {
    expect(resolveRewindBranchMessageId([
      { id: 'starter', role: 'assistant' },
      { id: 'u1', role: 'user' },
    ], 'u1')).toBeNull()
  })

  it('does not branch from a provider message whose branch anchor is unavailable', () => {
    expect(resolveRewindBranchMessageId([
      { id: 'u1', role: 'user' },
      { id: 'a1', role: 'assistant', turnId: 'turn-a1', canBranch: false },
      { id: 'u2', role: 'user' },
    ], 'u2')).toBeNull()
  })

  it('uses a fresh session when editing the first user message', () => {
    expect(resolveRewindBranchMessageId(baseSession.messages, 'u1')).toBeNull()
  })

  it('uses the default managed connection when creating a rewind branch', () => {
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

  it('preserves the source connection and model when editing the first user message', () => {
    expect(buildRewindSessionOptions(baseSession, null)).toEqual({
      name: 'Rewind of Planning',
      llmConnection: 'pi',
      model: 'glm-5.1',
      permissionMode: 'ask',
      workingDirectory: '/repo',
      enabledSourceSlugs: ['docs'],
    })
  })

  it('allows default rewind branches only when the source session already uses the default connection', () => {
    expect(MANAGED_DEFAULT_CONNECTION_SLUG).toBe('wangsu-default')
    expect(canCreateDefaultRewindBranch(baseSession, 'a1', 'pi')).toBe(true)
    expect(canCreateDefaultRewindBranch(baseSession, 'a1', 'wangsu-default')).toBe(false)
    expect(canCreateDefaultRewindBranch(baseSession, null, 'wangsu-default')).toBe(true)
  })
})
