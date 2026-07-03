// input: tool event handler source and synthetic tool session state
// output: regression coverage for the renderer tool-message hot path
// pos: guards tool events against unnecessary full-message scans on the common latest-tool path

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { handleToolResult } from '../tool'
import type { SessionState, ToolResultEvent } from '../../types'

const toolHandlerSource = readFileSync(new URL('../tool.ts', import.meta.url), 'utf-8')

function makeState(messages: any[]): SessionState {
  return {
    session: {
      id: 'session-1',
      messages,
      lastMessageAt: 1,
    } as any,
    streaming: null,
  }
}

describe('tool message hot path', () => {
  it('checks the last tool message before scanning the full transcript', () => {
    expect(toolHandlerSource).toContain('function getLastToolMessageIndex')
    expect(toolHandlerSource).toContain('const lastToolIndex = getLastToolMessageIndex(messages, toolUseId)')
    expect(toolHandlerSource).toContain('lastToolIndex === -1')
    expect(toolHandlerSource).toContain('findToolMessage(messages, toolUseId)')
  })

  it('updates the latest matching tool message with result data', () => {
    const state = makeState([
      {
        id: 'tool-1',
        role: 'tool',
        content: '',
        timestamp: 1,
        toolUseId: 'tool-1',
        toolName: 'Bash',
        toolStatus: 'executing',
      },
    ])
    const event: ToolResultEvent = {
      type: 'tool_result',
      sessionId: 'session-1',
      toolUseId: 'tool-1',
      result: 'ok',
    }

    const next = handleToolResult(state, event)

    expect(next.session.messages).toHaveLength(1)
    expect((next.session.messages[0] as any).toolResult).toBe('ok')
    expect((next.session.messages[0] as any).toolStatus).toBe('completed')
  })
})
