// input: Token usage values reported by the active session and model metadata
// output: Compact display data for the chat input context usage control
// pos: Pure formatting layer for context occupancy UI

export interface ContextUsageInput {
  inputTokens?: number
  contextTokens?: number
  contextWindow?: number
}

export interface ContextUsageDisplay {
  tokens: number
  contextWindow: number
  percent: number
  label: string
  tokenLabel: string
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(tokens >= 10_000 ? 0 : 1)}k`
  }
  return tokens.toString()
}

export function resolveContextUsage(input: ContextUsageInput): ContextUsageDisplay | null {
  const tokens = input.contextTokens ?? input.inputTokens ?? 0
  const contextWindow = input.contextWindow ?? 0
  if (contextWindow <= 0) return null

  const percent = Math.min(100, Math.max(0, Math.round((tokens / contextWindow) * 100)))

  return {
    tokens,
    contextWindow,
    percent,
    label: `${percent}%`,
    tokenLabel: `${formatTokenCount(tokens)} / ${formatTokenCount(contextWindow)}`,
  }
}
