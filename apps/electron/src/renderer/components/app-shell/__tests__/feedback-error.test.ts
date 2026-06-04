// input: Errors thrown by Electron feedback IPC
// output: Regression coverage for user-facing feedback error messages
// pos: Keeps feedback submission failures from exposing Electron IPC internals

import { describe, expect, it } from 'bun:test'
import { formatFeedbackErrorMessage } from '../feedback-error'

describe('formatFeedbackErrorMessage', () => {
  it('removes Electron IPC wrapper text from feedback submission failures', () => {
    expect(formatFeedbackErrorMessage(
      new Error("Error invoking remote method 'feedback:submitIssue': Error: Feedback service is unreachable. Check your network and try again.")
    )).toBe('Feedback service is unreachable. Check your network and try again.')
  })

  it('falls back to a stable feedback failure message for empty errors', () => {
    expect(formatFeedbackErrorMessage('')).toBe('Feedback submission failed. Please try again later.')
  })
})
