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
      ensureManagedModelAccessToken: async () => ({ token: 'managed-token', refreshed: false }),
    })
  })

  it('offers a safe retry without claiming an unobserved refresh outcome', () => {
    const normalized = normalizeManagedDefaultGatewayAuthError(baseInvalidApiKeyError, 'storyflow-managed')

    expect(normalized.code).toBe('invalid_api_key')
    expect(normalized.title).toBe('Default AI Access Interrupted')
    expect(normalized.message).toBe(
      'Default AI access was interrupted. Retry this message; if sign-in appears, sign in again.',
    )
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

  it('pushes explicit managed model access into matching live runtimes', async () => {
    const sm = new SessionManager()
    const managed = createManagedSession({
      id: 'managed-credential-update',
      llmConnection: 'storyflow-managed',
    }, {
      id: 'ws-test',
      name: 'Test',
      rootPath: '/tmp/managed-credential-update',
      createdAt: Date.now(),
    } as never, { messagesLoaded: true }) as any
    const reloadCredentials = jest.fn().mockResolvedValue(true)
    managed.agent = {
      reloadCredentials,
      isProcessing: () => false,
    }
    ;(sm as any).sessions.set(managed.id, managed)

    await sm.reloadConnectionCredentials('storyflow-managed', { token: 'managed-model-token' })

    expect(reloadCredentials).toHaveBeenCalledWith({ token: 'managed-model-token' })
  })

  it('renews managed access for the next operation without mutating the failed runtime', async () => {
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
    const reloadCredentials = jest.fn().mockResolvedValue(true)
    const disposeForRestart = jest.fn().mockResolvedValue(undefined)
    managed.agent = {
      reloadCredentials,
      disposeForRestart,
      isProcessing: () => false,
    }
    managed.isProcessing = true
    managed.messages = [{ id: 'user-1', role: 'user', content: 'hello', timestamp: 1 }]
    ;(sm as any).sessions.set(managed.id, managed)
    const sendMessage = jest.fn().mockResolvedValue(undefined)
    ;(sm as any).sendMessage = sendMessage
    const ensureManagedModelAccessToken = jest.fn().mockResolvedValue({
      token: 'managed-token',
      refreshed: true,
    })
    setSessionRuntimeHooks({ ensureManagedModelAccessToken })

    await (sm as any).processEvent(managed, {
      type: 'typed_error',
      error: baseInvalidApiKeyError,
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(ensureManagedModelAccessToken).toHaveBeenCalledWith(true)
    expect(reloadCredentials).not.toHaveBeenCalled()
    expect(disposeForRestart).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(managed.messages.at(-1)?.role).toBe('error')
    expect(managed.messages.at(-1)?.content).toBe(
      'Default AI access was interrupted. Retry this message; if sign-in appears, sign in again.',
    )
  })

  it('does not recycle an idle runtime until the next operation preflight', async () => {
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
    const dispose = jest.fn()
    managed.agent = { isProcessing: () => false, dispose }
    managed.isProcessing = true
    ;(sm as any).sessions.set(managed.id, managed)
    const sendMessage = jest.fn().mockResolvedValue(undefined)
    ;(sm as any).sendMessage = sendMessage
    const ensureManagedModelAccessToken = jest.fn().mockResolvedValue({
      token: 'managed-token',
      refreshed: true,
    })
    setSessionRuntimeHooks({ ensureManagedModelAccessToken })

    await (sm as any).processEvent(managed, {
      type: 'typed_error',
      error: baseInvalidApiKeyError,
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(sendMessage).not.toHaveBeenCalled()
    expect(ensureManagedModelAccessToken).toHaveBeenCalledWith(true)
    expect(dispose).not.toHaveBeenCalled()
  })

  it('injects a renewed capability before reusing an idle runtime', async () => {
    const sm = new SessionManager()
    const managed = createManagedSession({
      id: 'managed-operation-preflight',
      llmConnection: 'storyflow-managed',
    }, {
      id: 'ws-test',
      name: 'Test',
      rootPath: '/tmp/managed-operation-preflight',
      createdAt: Date.now(),
    } as never, { messagesLoaded: true }) as any
    const reloadCredentials = jest.fn().mockResolvedValue(true)
    const agent = {
      reloadCredentials,
      isProcessing: () => false,
    }
    managed.agent = agent
    managed.managedModelAccessToken = 'old-managed-token'
    ;(sm as any).sessions.set(managed.id, managed)
    ;(sm as any).tryRefreshAgentRuntimeLocked = async () => {}
    setSessionRuntimeHooks({
      ensureManagedModelAccessToken: async () => ({
        token: 'renewed-managed-token',
        refreshed: false,
      }),
    })

    await expect((sm as any).getOrCreateAgentLocked(managed)).resolves.toBe(agent)

    expect(reloadCredentials).toHaveBeenCalledWith({ token: 'renewed-managed-token' })
    expect(managed.managedModelAccessToken).toBe('renewed-managed-token')
  })
})
