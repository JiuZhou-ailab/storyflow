// input: Synthetic managed session message lists
// output: Regression checks for rewind message-id resolution fallbacks
// pos: Guards optimistic-id mismatch healing for in-place rewind

import { describe, expect, it } from 'bun:test'
import { resolveRewindMessageIndex } from '../rewind-resolve'

const transcript = [
  { id: 'srv-u1', role: 'user', content: 'first' },
  { id: 'a1', role: 'assistant', content: 'ok' },
  { id: 'srv-u2', role: 'user', content: 'second' },
  { id: 'a2', role: 'assistant', content: 'ok' },
]

describe('resolveRewindMessageIndex', () => {
  it('resolves by server id', () => {
    expect(resolveRewindMessageIndex(transcript, 'srv-u2')).toBe(2)
  })

  it('falls back to user ordinal when UI still has an optimistic id', () => {
    expect(resolveRewindMessageIndex(transcript, 'msg-optimistic-u2', { userOrdinal: 1 })).toBe(2)
    expect(resolveRewindMessageIndex(transcript, 'msg-optimistic-u1', { userOrdinal: 0 })).toBe(0)
  })

  it('falls back to unique content match', () => {
    expect(resolveRewindMessageIndex(transcript, 'msg-optimistic', { content: 'first' })).toBe(0)
  })

  it('does not guess when content is ambiguous', () => {
    const duped = [
      { id: 'u1', role: 'user', content: 'same' },
      { id: 'a1', role: 'assistant', content: 'x' },
      { id: 'u2', role: 'user', content: 'same' },
    ]
    expect(resolveRewindMessageIndex(duped, 'missing', { content: 'same' })).toBe(-1)
    expect(resolveRewindMessageIndex(duped, 'missing', { userOrdinal: 1, content: 'same' })).toBe(2)
  })
})
