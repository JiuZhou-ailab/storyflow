import { describe, expect, it } from 'bun:test'
import {
  buildRewindSessionOptions,
  resolveRewindBranchMessageId,
} from '../chat-rewind'

const baseSession = {
  id: 'session-1',
  workspaceId: 'workspace-1',
  name: 'Planning',
  llmConnection: 'pi',
  model: 'glm-5.1',
  permissionMode: 'ask' as const,
  workingDirectory: '/repo',
  enabledSourceSlugs: ['docs'],
  messages: [
    { id: 'u1', role: 'user', content: 'first' },
    { id: 'a1', role: 'assistant', content: 'answer' },
    { id: 'u2', role: 'user', content: 'second' },
  ],
}

describe('chat rewind helpers', () => {
  it('branches from the message before the edited user message', () => {
    expect(resolveRewindBranchMessageId(baseSession.messages, 'u2')).toBe('a1')
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
