// input: Session-level typed auth errors for managed and user-owned LLM connections
// output: Regression coverage for default gateway auth-error presentation
// pos: Focused test for presenting managed model access as model config, not login recovery

import { describe, expect, it } from 'bun:test'
import type { TypedError } from '@craft-agent/core/types'
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
  it('maps hidden default gateway auth failures to model access settings, not reauth', () => {
    const normalized = normalizeManagedDefaultGatewayAuthError(baseInvalidApiKeyError, 'wangsu-default')

    expect(normalized.code).toBe('invalid_api_key')
    expect(normalized.title).toBe('Default AI Access Unavailable')
    expect(normalized.message.toLowerCase()).not.toContain('api key')
    expect(normalized.actions.some(action => action.action === 'reauth')).toBe(false)
    expect(normalized.actions).toEqual([
      {
        key: 's',
        label: 'Open model settings',
        command: '/settings',
        action: 'settings',
      },
    ])
    expect(normalized.originalError).toBeUndefined()
  })

  it('leaves ordinary user API-key connections unchanged', () => {
    const normalized = normalizeManagedDefaultGatewayAuthError(baseInvalidApiKeyError, 'pi-api-key')

    expect(normalized).toBe(baseInvalidApiKeyError)
  })
})
