// input: Session-level typed auth errors for managed and user-owned LLM connections
// output: Regression coverage for default gateway auth-error recovery presentation
// pos: Focused test keeping hidden managed credentials out of user settings

import { afterEach, describe, expect, it, jest } from 'bun:test'
import type { TypedError } from '@craft-agent/core/types'
import { ManagedAccessRefreshError, type ManagedAccessRecovery } from '@craft-agent/shared/auth/managed-access'
import { setupI18n } from '@craft-agent/shared/i18n'
import { FREE_CONVERSATION_WORKSPACE_ID } from '@craft-agent/shared/protocol'
import { createManagedSession, SessionManager, setSessionRuntimeHooks } from './SessionManager.ts'
import { normalizeManagedDefaultGatewayAuthError, presentManagedAccessRecovery, type ManagedAccessRenewal } from './managed-gateway-auth-error'

const LEGACY_INTERRUPTED_MESSAGE = 'Default AI access was interrupted. Retry this message; if sign-in appears, sign in again.'

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

const renewTo = (renewal: ManagedAccessRenewal) => jest.fn(async () => renewal)
const neverRenew = () => jest.fn(async (): Promise<ManagedAccessRenewal> => {
  throw new Error('a final rejection must not renew access')
})
const gatewayRejection = (status: number, body: Record<string, string>): TypedError => ({
  ...baseInvalidApiKeyError,
  code: status === 401 ? 'invalid_api_key' : 'service_error',
  originalError: `${status} ${JSON.stringify(body)}`,
})

function managedSession(id: string) {
  return createManagedSession({
    id,
    llmConnection: 'storyflow-managed',
  }, {
    id: FREE_CONVERSATION_WORKSPACE_ID,
    name: 'Test',
    rootPath: `/tmp/${id}`,
    createdAt: Date.now(),
  } as never, { messagesLoaded: true }) as any
}

describe('managed default gateway auth error normalization', () => {
  afterEach(async () => {
    await setupI18n().changeLanguage('en')
    setSessionRuntimeHooks({
      ensureManagedModelAccessToken: async () => ({ token: 'managed-token', refreshed: false }),
    })
  })

  it('preserves safe authorization evidence without retrying a permission denial', async () => {
    const renew = neverRenew()
    const normalized = await normalizeManagedDefaultGatewayAuthError({ ...baseInvalidApiKeyError,
      code: 'service_error', originalError: '403 {"code":"managed_access_denied","reason":"account_disabled","stage":"model","correlation_id":"call-42","secret":"never-persist"}',
    }, 'storyflow-managed', renew)
    expect(normalized.title).toBe('Managed model access removed')
    expect(normalized.message).toContain('Contact your administrator')
    expect(normalized.canRetry).toBe(false)
    expect(normalized.actions).toEqual([])
    expect(normalized.details).toEqual(['Reference: call-42'])
    expect(normalized.originalError).toContain('call-42')
    expect(normalized.originalError).not.toContain('never-persist')
    expect(renew).not.toHaveBeenCalled()
  })

  it.each([
    ['scope_denied', 'managed_access_denied', 403],
    ['model_denied', 'managed_access_denied', 403],
  ] as const)('treats %s as removed permission without renewal', async (reason, code, status) => {
    const renew = neverRenew()
    const normalized = await normalizeManagedDefaultGatewayAuthError(
      gatewayRejection(status, { code, reason, stage: 'model' }), 'storyflow-managed', renew)
    expect(normalized.title).toBe('Managed model access removed')
    expect(normalized.canRetry).toBe(false)
    expect(renew).not.toHaveBeenCalled()
  })

  it('reports an authorization outage as temporary without renewing or signing out', async () => {
    const renew = neverRenew()
    const normalized = await normalizeManagedDefaultGatewayAuthError(gatewayRejection(503, {
      code: 'authorization_dependency_unavailable', reason: 'dependency_unavailable', stage: 'model', correlation_id: 'call-503',
    }), 'storyflow-managed', renew)
    expect(normalized.title).toBe('Access service temporarily unavailable')
    expect(normalized.message).toContain("You're still signed in")
    expect(normalized.canRetry).toBe(true)
    expect(normalized.actions).toEqual([{ key: 'r', label: 'Retry', action: 'retry' }])
    expect(normalized.code).toBe('service_error')
    expect(renew).not.toHaveBeenCalled()
  })

  it.each([
    ['retry', 'Managed model access renewed', 'Send your message again', true, 'invalid_api_key'],
    ['sign_in', 'Sign in again', 'Sign in again, then send your message again', false, 'invalid_api_key'],
    ['access_removed', 'Managed model access removed', 'Contact your administrator', false, 'service_error'],
    ['service_unavailable', 'Access service temporarily unavailable', "You're still signed in", true, 'service_error'],
  ] as const)('a legacy gateway 401 shows the observed renewal outcome: %s', async (recovery, title, message, canRetry, code) => {
    const renew = renewTo({ recovery, ...(recovery === 'retry' ? {} : { correlationId: 'broker-7' }) })
    const normalized = await normalizeManagedDefaultGatewayAuthError(baseInvalidApiKeyError, 'storyflow-managed', renew)

    expect(renew).toHaveBeenCalledTimes(1)
    expect(normalized.title).toBe(title)
    expect(normalized.message).toContain(message)
    expect(normalized.message).not.toBe(LEGACY_INTERRUPTED_MESSAGE)
    expect(normalized.code).toBe(code)
    expect(normalized.canRetry).toBe(canRetry)
    expect(normalized.actions.map(action => action.action)).toEqual(canRetry ? ['retry'] : [])
    expect(normalized.actions.some(action => action.action === 'reauth')).toBe(false)
    expect(normalized.retryDelayMs).toBeUndefined()
    // Raw provider text never survives; the observed renewal does.
    expect(JSON.parse(normalized.originalError!)).toEqual({
      renewal: recovery,
      ...(recovery === 'retry' ? {} : { renewal_correlation_id: 'broker-7' }),
    })
    expect(normalized.details).toEqual(recovery === 'retry' ? undefined : ['Reference: broker-7'])
  })

  it('renews an expired capability and reports the renewal result', async () => {
    const renew = renewTo({ recovery: 'retry' })
    const normalized = await normalizeManagedDefaultGatewayAuthError(gatewayRejection(401, {
      code: 'model_access_token_invalid', reason: 'token_expired', stage: 'model', correlation_id: 'call-exp',
    }), 'storyflow-managed', renew)
    expect(renew).toHaveBeenCalledTimes(1)
    expect(normalized.title).toBe('Managed model access renewed')
    expect(JSON.parse(normalized.originalError!)).toEqual({
      code: 'model_access_token_invalid', reason: 'token_expired', stage: 'model', correlation_id: 'call-exp', renewal: 'retry',
    })
  })

  it('a gateway session revocation asks for sign-in even if a racing renewal succeeded', async () => {
    const renew = renewTo({ recovery: 'retry' })
    const normalized = await normalizeManagedDefaultGatewayAuthError(gatewayRejection(401, {
      code: 'model_access_token_invalid', reason: 'session_revoked', stage: 'model',
    }), 'storyflow-managed', renew)
    // Renewal still runs so the broker can confirm the rejection and clear the local login.
    expect(renew).toHaveBeenCalledTimes(1)
    expect(normalized.title).toBe('Sign in again')
    expect(normalized.canRetry).toBe(false)
  })

  it('localizes the recovery in the current product language', async () => {
    await setupI18n().changeLanguage('zh-Hans')
    const normalized = await normalizeManagedDefaultGatewayAuthError(
      baseInvalidApiKeyError, 'storyflow-managed', renewTo({ recovery: 'service_unavailable', correlationId: 'broker-8' }))
    expect(normalized.title).toBe('访问服务暂时不可用')
    expect(normalized.message).toContain('你仍处于登录状态')
    expect(normalized.actions).toEqual([{ key: 'r', label: '重试', action: 'retry' }])
    expect(normalized.details).toEqual(['参考编号：broker-8'])
  })

  it('leaves ordinary user API-key connections unchanged', async () => {
    const renew = neverRenew()
    const normalized = await normalizeManagedDefaultGatewayAuthError(baseInvalidApiKeyError, 'pi-api-key', renew)

    expect(normalized).toBe(baseInvalidApiKeyError)
    expect(renew).not.toHaveBeenCalled()
  })

  it('leaves unrelated managed errors unchanged', async () => {
    const rateLimited: TypedError = { ...baseInvalidApiKeyError, code: 'rate_limited', originalError: '429 Too Many Requests' }
    const renew = neverRenew()
    expect(await normalizeManagedDefaultGatewayAuthError(rateLimited, 'storyflow-managed', renew)).toBe(rateLimited)
    expect(renew).not.toHaveBeenCalled()
  })

  it('presents a pre-send renewal failure without a gateway diagnostic', () => {
    const presented = presentManagedAccessRecovery('sign_in', {
      renewal: { recovery: 'sign_in', reason: 'session_revoked', correlationId: 'broker-9' },
    })
    expect(presented.title).toBe('Sign in again')
    expect(presented.canRetry).toBe(false)
    expect(JSON.parse(presented.originalError!)).toEqual({
      renewal: 'sign_in', renewal_reason: 'session_revoked', renewal_correlation_id: 'broker-9',
    })
  })

  it('pushes explicit managed model access into matching live runtimes', async () => {
    const sm = new SessionManager((_workspaceId, managed) => managed.workspace)
    const managed = managedSession('managed-credential-update')
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
    const sm = new SessionManager((_workspaceId, managed) => managed.workspace)
    const managed = managedSession('managed-retry')
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

    expect(ensureManagedModelAccessToken).toHaveBeenCalledTimes(1)
    expect(ensureManagedModelAccessToken).toHaveBeenCalledWith(true)
    expect(reloadCredentials).not.toHaveBeenCalled()
    expect(disposeForRestart).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(managed.messages.at(-1)).toMatchObject({
      role: 'error',
      errorTitle: 'Managed model access renewed',
      errorCanRetry: true,
    })
    expect(managed.messages.at(-1)?.content).not.toBe(LEGACY_INTERRUPTED_MESSAGE)
  })

  it.each([
    ['sign_in', 'Sign in again', false],
    ['access_removed', 'Managed model access removed', false],
    ['service_unavailable', 'Access service temporarily unavailable', true],
  ] as const)('shows a %s renewal failure from the host instead of a guess', async (recovery, title, canRetry) => {
    const sm = new SessionManager((_workspaceId, managed) => managed.workspace)
    const managed = managedSession(`managed-renewal-${recovery}`)
    managed.agent = { isProcessing: () => false }
    managed.isProcessing = true
    ;(sm as any).sessions.set(managed.id, managed)
    const sendMessage = jest.fn().mockResolvedValue(undefined)
    ;(sm as any).sendMessage = sendMessage
    setSessionRuntimeHooks({
      ensureManagedModelAccessToken: jest.fn().mockRejectedValue(
        new ManagedAccessRefreshError(recovery as Exclude<ManagedAccessRecovery, 'retry'>, { correlationId: 'broker-10' })),
    })

    await (sm as any).processEvent(managed, { type: 'typed_error', error: baseInvalidApiKeyError })

    expect(sendMessage).not.toHaveBeenCalled()
    expect(managed.messages.at(-1)).toMatchObject({
      role: 'error', errorTitle: title, errorCanRetry: canRetry, errorDetails: ['Reference: broker-10'],
    })
  })

  it('records sign-in after the rejected login aborts and revokes the reporting runtime', async () => {
    const sm = new SessionManager((_workspaceId, managed) => managed.workspace)
    const managed = managedSession('managed-renewal-revoked-runtime')
    const forceAbort = jest.fn()
    managed.agent = { isProcessing: () => true, forceAbort, dispose: jest.fn() }
    managed.isProcessing = true
    managed.messages = []
    ;(sm as any).sessions.set(managed.id, managed)
    let revocation: Promise<void> | undefined
    setSessionRuntimeHooks({
      ensureManagedModelAccessToken: async () => {
        // Mirrors Electron: clearing a rejected login revokes managed runtimes without awaiting.
        revocation = sm.disposeConnectionRuntimes('storyflow-managed')
        throw new ManagedAccessRefreshError('sign_in', { reason: 'session_revoked' })
      },
    })

    await (sm as any).processEvent(managed, { type: 'typed_error', error: baseInvalidApiKeyError })
    await revocation

    expect(forceAbort).toHaveBeenCalledTimes(1)
    expect(managed.messages).toHaveLength(1)
    expect(managed.messages[0]).toMatchObject({ role: 'error', errorTitle: 'Sign in again', errorCanRetry: false })
  })

  it('treats an unclassified renewal failure as temporary rather than a sign-out', async () => {
    const sm = new SessionManager((_workspaceId, managed) => managed.workspace)
    const managed = managedSession('managed-renewal-unknown')
    managed.agent = { isProcessing: () => false }
    managed.isProcessing = true
    ;(sm as any).sessions.set(managed.id, managed)
    setSessionRuntimeHooks({ ensureManagedModelAccessToken: jest.fn().mockRejectedValue(new Error('socket hang up')) })

    await (sm as any).processEvent(managed, { type: 'typed_error', error: baseInvalidApiKeyError })

    expect(managed.messages.at(-1)).toMatchObject({ errorTitle: 'Access service temporarily unavailable', errorCanRetry: true })
  })

  it('drops the error when the user stops the turn while renewal is in flight', async () => {
    const sm = new SessionManager((_workspaceId, managed) => managed.workspace)
    const managed = managedSession('managed-renewal-stopped')
    managed.agent = { isProcessing: () => false }
    managed.isProcessing = true
    managed.messages = []
    ;(sm as any).sessions.set(managed.id, managed)
    setSessionRuntimeHooks({
      ensureManagedModelAccessToken: async () => {
        managed.isProcessing = false
        return { token: 'managed-token', refreshed: true }
      },
    })

    await (sm as any).processEvent(managed, { type: 'typed_error', error: baseInvalidApiKeyError })

    expect(managed.messages).toEqual([])
  })

  it('does not recycle an idle runtime until the next operation preflight', async () => {
    const sm = new SessionManager((_workspaceId, managed) => managed.workspace)
    const managed = managedSession('managed-no-replay')
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

    expect(sendMessage).not.toHaveBeenCalled()
    expect(ensureManagedModelAccessToken).toHaveBeenCalledWith(true)
    expect(dispose).not.toHaveBeenCalled()
  })

  it('injects a renewed capability before reusing an idle runtime', async () => {
    const sm = new SessionManager((_workspaceId, managed) => managed.workspace)
    const managed = managedSession('managed-operation-preflight')
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
