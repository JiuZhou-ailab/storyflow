import { describe, expect, it, mock } from 'bun:test'
import {
  getErrorMessageBody,
  handleErrorMessageAction,
  type ErrorMessageAction,
} from '../error-message-actions'

describe('getErrorMessageBody', () => {
  it('strips one exact legacy title prefix', () => {
    expect(getErrorMessageBody({
      content: 'Default AI Access Interrupted: Default AI Access Interrupted: Try again',
      errorTitle: 'Default AI Access Interrupted',
    })).toBe('Default AI Access Interrupted: Try again')
  })

  it('preserves content that does not start with the exact title prefix', () => {
    expect(getErrorMessageBody({
      content: 'Default AI Access Interrupted:Try again',
      errorTitle: 'Default AI Access Interrupted',
    })).toBe('Default AI Access Interrupted:Try again')
    expect(getErrorMessageBody({ content: 'Try again' })).toBe('Try again')
  })
})

describe('handleErrorMessageAction', () => {
  it('routes retry through the session-scoped focus handler', () => {
    const onRetryFocus = mock(() => {})
    const action: ErrorMessageAction = {
      key: 'r',
      label: 'Retry',
      action: 'retry',
    }

    handleErrorMessageAction(action, {
      sessionId: 'session-123',
      onRetryFocus,
    })

    expect(onRetryFocus).toHaveBeenCalledTimes(1)
    expect(onRetryFocus).toHaveBeenCalledWith({ sessionId: 'session-123' })
  })

  it('opens the provided URL for open_url actions', () => {
    const onOpenUrl = mock(() => {})
    const action: ErrorMessageAction = {
      key: 'docs',
      label: 'Open docs',
      action: 'open_url',
      url: 'https://example.com/status',
    }

    handleErrorMessageAction(action, { onOpenUrl })

    expect(onOpenUrl).toHaveBeenCalledTimes(1)
    expect(onOpenUrl).toHaveBeenCalledWith('https://example.com/status')
  })

  it('calls onRetry instead of onRetryFocus when provided', () => {
    const onRetry = mock(() => {})
    const onRetryFocus = mock(() => {})
    const action: ErrorMessageAction = {
      key: 'r',
      label: 'Retry',
      action: 'retry',
    }

    handleErrorMessageAction(action, {
      sessionId: 'session-123',
      onRetry,
      onRetryFocus,
    })

    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetryFocus).not.toHaveBeenCalled()
  })

  it('runs the settings handler for settings actions', () => {
    const onOpenSettings = mock(() => {})
    const action: ErrorMessageAction = {
      key: 'settings',
      label: 'Settings',
      action: 'settings',
    }

    handleErrorMessageAction(action, { onOpenSettings })

    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })
})
