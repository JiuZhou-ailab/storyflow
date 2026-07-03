// input: Tool result payloads from renderer agent events
// output: Cheap detection for background task start responses
// pos: Shared renderer helper for background task cleanup decisions

const BACKGROUND_ID_PATTERN = /[a-zA-Z0-9_-]+/
const LEGACY_BACKGROUND_RESULT_PATTERNS = [
  new RegExp(`agentId:\\s*${BACKGROUND_ID_PATTERN.source}`),
  new RegExp(`shell_id:\\s*${BACKGROUND_ID_PATTERN.source}`),
  new RegExp(`"backgroundTaskId":\\s*"${BACKGROUND_ID_PATTERN.source}"`),
]

export function isBackgroundingToolResult(result: unknown): boolean {
  if (typeof result === 'string') {
    return LEGACY_BACKGROUND_RESULT_PATTERNS.some(pattern => pattern.test(result))
  }
  if (!result || typeof result !== 'object') return false

  const record = result as Record<string, unknown>
  return typeof record.backgroundTaskId === 'string'
    || typeof record.agentId === 'string'
    || typeof record.shell_id === 'string'
}
