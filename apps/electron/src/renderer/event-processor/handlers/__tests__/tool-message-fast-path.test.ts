// input: tool event handler source and synthetic tool session state
// output: regression coverage for the renderer tool-message hot path
// pos: guards tool events against unnecessary full-message scans on the common latest-tool path

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { handleTaskProgress, handleToolResult, handleToolStart } from '../tool'
import type { SessionState, TaskProgressEvent, ToolResultEvent, ToolStartEvent } from '../../types'

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

  it('keeps the original state for duplicate tool start data', () => {
    const state = makeState([
      {
        id: 'tool-1',
        role: 'tool',
        content: '',
        timestamp: 1,
        toolUseId: 'tool-1',
        toolName: 'Bash',
        toolInput: { command: 'pwd' },
        toolStatus: 'executing',
        turnId: 'turn-1',
      },
    ])
    const event: ToolStartEvent = {
      type: 'tool_start',
      sessionId: 'session-1',
      toolUseId: 'tool-1',
      toolName: 'Bash',
      toolInput: state.session.messages[0].toolInput,
      turnId: 'turn-1',
    }

    expect(handleToolStart(state, event)).toBe(state)
  })

  it('keeps the original state for duplicate task progress seconds', () => {
    const state = makeState([
      {
        id: 'tool-1',
        role: 'tool',
        content: '',
        timestamp: 1,
        toolUseId: 'tool-1',
        toolName: 'Task',
        toolStatus: 'backgrounded',
        elapsedSeconds: 12,
      },
    ])
    const event: TaskProgressEvent = {
      type: 'task_progress',
      sessionId: 'session-1',
      toolUseId: 'tool-1',
      elapsedSeconds: 12,
    }

    expect(handleTaskProgress(state, event)).toBe(state)
  })
})
