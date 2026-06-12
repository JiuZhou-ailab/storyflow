// input: Agent backend compaction capability, session turn counters, and send-turn log/span adapters
// output: Proactive provider-context compaction execution result
// pos: Session-turn lifecycle module that keeps proactive compaction orchestration out of SessionManager

import { shouldAutoCompact } from '@craft-agent/shared/agent'
import type { AgentBackend } from '@craft-agent/shared/agent/backend'

export const AUTO_COMPACT_CONTEXT_INSTRUCTIONS =
  'Preserve durable decisions, current task state, open questions, file paths, and user preferences. Omit redundant step-by-step chatter.'

interface AutoCompactLogger {
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string): void
}

interface AutoCompactSpan {
  mark(label: string): void
}

export interface RunAutoCompactBeforeTurnInput {
  sessionId: string
  userIteration: number
  lastCompactedUserIteration?: number
  agent: Pick<AgentBackend, 'compactContext' | 'getSessionId'>
  isRetry?: boolean
  isHiddenUserMessage?: boolean
  log: AutoCompactLogger
  span: AutoCompactSpan
}

export interface RunAutoCompactBeforeTurnResult {
  compacted: boolean
  nextLastCompactedUserIteration?: number
  reason?: string
  tokensBefore?: number
}

export async function runAutoCompactBeforeTurn(
  input: RunAutoCompactBeforeTurnInput
): Promise<RunAutoCompactBeforeTurnResult> {
  const decision = shouldAutoCompact({
    userIteration: input.userIteration,
    lastCompactedUserIteration: input.lastCompactedUserIteration,
    hasCompactionCapability: typeof input.agent.compactContext === 'function',
    hasProviderSession: !!input.agent.getSessionId(),
    isRetry: input.isRetry,
    isHiddenUserMessage: input.isHiddenUserMessage,
  })
  if (!decision.shouldCompact || !input.agent.compactContext) {
    return { compacted: false, reason: decision.reason }
  }

  input.span.mark('autoCompact.starting')
  try {
    input.log.info('Auto-compacting provider context before user turn', {
      sessionId: input.sessionId,
      userIteration: input.userIteration,
      reason: decision.reason,
    })
    const result = await input.agent.compactContext(AUTO_COMPACT_CONTEXT_INSTRUCTIONS)
    input.span.mark('autoCompact.complete')
    input.log.info('Auto-compacted provider context', {
      sessionId: input.sessionId,
      userIteration: input.userIteration,
      tokensBefore: result?.tokensBefore,
    })
    return {
      compacted: true,
      nextLastCompactedUserIteration: input.userIteration,
      reason: decision.reason,
      tokensBefore: result?.tokensBefore,
    }
  } catch (error) {
    input.span.mark('autoCompact.failed')
    input.log.warn(
      `Auto-compaction failed for session ${input.sessionId}: ${error instanceof Error ? error.message : error}`
    )
    return { compacted: false, reason: 'compaction failed' }
  }
}
