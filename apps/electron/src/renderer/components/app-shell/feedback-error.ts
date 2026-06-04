// input: Errors thrown by Electron feedback IPC
// output: User-facing feedback failure messages
// pos: Renderer-side feedback error normalization boundary

const FEEDBACK_IPC_ERROR_PREFIX = /^Error invoking remote method 'feedback:submitIssue':\s*/
const ERROR_NAME_PREFIX = /^(?:Error|TypeError):\s*/
const FALLBACK_FEEDBACK_ERROR = 'Feedback submission failed. Please try again later.'

export function formatFeedbackErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const message = raw
    .replace(FEEDBACK_IPC_ERROR_PREFIX, '')
    .replace(ERROR_NAME_PREFIX, '')
    .trim()
  return message || FALLBACK_FEEDBACK_ERROR
}
