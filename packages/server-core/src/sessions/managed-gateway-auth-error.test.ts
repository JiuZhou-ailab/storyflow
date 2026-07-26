// input: Session-level typed auth errors for managed and user-owned LLM connections
// output: Regression coverage for default gateway auth-error presentation
// pos: Focused test keeping hidden managed credentials out of user settings

import { afterEach, describe, expect, it, jest } from 'bun:test'
import type { TypedError } from '@craft-agent/core/types'
import { createManagedSession, SessionManager, setSessionRuntimeHooks } from './SessionManager.ts'
import { normalizeManagedDefaultGatewayAuthError } from './managed-gateway-auth-error'

const baseInvalidApiKeyError: TypedError = {
  code: 'invalid_api_key',
  title: 'Invalid API Key',
  message: 'Your API key was rejected. It may be invalid or expired.',
  actions: [
    {
      key: 's',
      label: 'Update API key',
      command: '/settings',
      action: 'settings',
    },
  ],
  canRetry: false,
  originalError: '401 {"error":{"code":"auth_failed","message":"ApiKey Validate fail","type":"auth_failed"}}',
}

describe('managed default gateway auth error normalization', () => {
  afterEach(() => {
    setSessionRuntimeHooks({
      ensureManagedModelAccessToken: async () => ({ refreshed: false }),
    })
  })

  it('offers a safe retry without exposing hidden model credentials', () => {
    const normalized = normalizeManagedDefaultGatewayAuthError(baseInvalidApiKeyError, 'storyflow-managed')

    expect(normalized.code).toBe('invalid_api_key')
    expect(normalized.title).toBe('Default AI Access Interrupted')
    expect(normalized.message.toLowerCase()).not.toContain('api key')
    expect(normalized.actions.some(action => action.action === 'reauth')).toBe(false)
    expect(normalized.actions).toEqual([
      {
        key: 'r',
        label: 'Retry',
        action: 'retry',
      },
    ])
    expect(normalized.canRetry).toBe(true)
    expect(normalized.originalError).toBeUndefined()
  })

  it('leaves ordinary user API-key connections unchanged', () => {
    const normalized = normalizeManagedDefaultGatewayAuthError(baseInvalidApiKeyError, 'pi-api-key')

    expect(normalized).toBe(baseInvalidApiKeyError)
  })

  it('force-refreshes and safely retries a managed turn before any tool ran', async () => {
    const sm = new SessionManager()
    const managed = createManagedSession({
      id: 'managed-retry',
      llmConnection: 'storyflow-managed',
    }, {
      id: 'ws-test',
      name: 'Test',
      rootPath: '/tmp/managed-retry',
      createdAt: Date.now(),
    } as never, { messagesLoaded: true }) as any
    const disposeForRestart = jest.fn().mockResolvedValue(undefined)
    managed.agent = {
      disposeForRestart,
      isProcessing: () => false,
    }
    managed.isProcessing = true
    managed.authRetrySafe = true
    managed.lastSentMessage = 'hello'
    managed.messages = [{ id: 'user-1', role: 'user', content: 'hello', timestamp: 1 }]
    ;(sm as any).sessions.set(managed.id, managed)
    const sendMessage = jest.fn().mockResolvedValue(undefined)
    ;(sm as any).sendMessage = sendMessage
    const ensureManagedModelAccessToken = jest.fn().mockResolvedValue({ refreshed: true })
    setSessionRuntimeHooks({ ensureManagedModelAccessToken })

    await (sm as any).processEvent(managed, {
      type: 'typed_error',
      error: baseInvalidApiKeyError,
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(ensureManagedModelAccessToken).toHaveBeenCalledWith(true)
    expect(disposeForRestart).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('does not replay a managed turn after tool activity', async () => {
    const sm = new SessionManager()
    const managed = createManagedSession({
      id: 'managed-no-replay',
      llmConnection: 'storyflow-managed',
    }, {
      id: 'ws-test',
      name: 'Test',
      rootPath: '/tmp/managed-no-replay',
      createdAt: Date.now(),
    } as never, { messagesLoaded: true }) as any
    managed.agent = { isProcessing: () => false, dispose: () => {} }
    managed.isProcessing = true
    managed.authRetrySafe = false
    managed.lastSentMessage = 'hello'
    ;(sm as any).sessions.set(managed.id, managed)
    const sendMessage = jest.fn().mockResolvedValue(undefined)
    ;(sm as any).sendMessage = sendMessage
    const ensureManagedModelAccessToken = jest.fn().mockResolvedValue({ refreshed: true })
    setSessionRuntimeHooks({ ensureManagedModelAccessToken })

    await (sm as any).processEvent(managed, {
      type: 'typed_error',
      error: baseInvalidApiKeyError,
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(sendMessage).not.toHaveBeenCalled()
    expect(ensureManagedModelAccessToken).toHaveBeenCalledWith(true)
  })
})
