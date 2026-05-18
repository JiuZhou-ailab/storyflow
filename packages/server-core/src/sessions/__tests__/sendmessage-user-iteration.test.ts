// input: SessionManager send-message orchestration source
// output: Regression coverage for user-message iteration propagation to agents
// pos: Guards method-pack periodic reminder scheduling at the session boundary

import { readFileSync } from 'fs'
import { describe, expect, it } from 'bun:test'

describe('SessionManager user iteration propagation', () => {
  it('passes the current user-message count into agent chat options', () => {
    const source = readFileSync(new URL('../SessionManager.ts', import.meta.url), 'utf-8')

    expect(source).toContain("const userIteration = managed.messages.filter(message => message.role === 'user').length")
    expect(source).toContain('userIteration,')
    expect(source).toContain('agent.chat(effectiveMessage, modelInputAttachments.attachments, {')
  })
})
