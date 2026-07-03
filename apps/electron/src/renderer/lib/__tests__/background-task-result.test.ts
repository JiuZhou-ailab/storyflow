// input: Tool result payloads from renderer agent events
// output: Backgrounding-result detection without serializing large objects
// pos: Keeps background task cleanup checks cheap for large tool_result payloads

import { describe, expect, it } from 'bun:test'
import { isBackgroundingToolResult } from '../background-task-result'

describe('isBackgroundingToolResult', () => {
  it('detects legacy backgrounding result strings', () => {
    expect(isBackgroundingToolResult('started\nagentId: bg_agent_123')).toBe(true)
    expect(isBackgroundingToolResult('started\nshell_id: shell_123')).toBe(true)
    expect(isBackgroundingToolResult('{"backgroundTaskId": "shell_watch_123"}')).toBe(true)
  })

  it('detects structured background task ids without stringifying payloads', () => {
    const result = {
      backgroundTaskId: 'shell_watch_123',
      toJSON() {
        throw new Error('should not stringify')
      },
    }

    expect(isBackgroundingToolResult(result)).toBe(true)
  })

  it('does not stringify ordinary object payloads', () => {
    const result = {
      output: 'large normal result',
      toJSON() {
        throw new Error('should not stringify')
      },
    }

    expect(isBackgroundingToolResult(result)).toBe(false)
  })
})
