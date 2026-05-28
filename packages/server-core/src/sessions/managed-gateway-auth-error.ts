// input: Typed provider auth errors and session LLM connection slug
// output: User-facing managed-gateway auth errors that hide API-key setup details
// pos: Session error normalization boundary for bundled default AI access

import type { TypedError } from '@craft-agent/core/types'

export const MANAGED_DEFAULT_GATEWAY_CONNECTION_SLUG = 'wangsu-default'
export const MANAGED_GATEWAY_CONNECTION_SLUGS = new Set([
  MANAGED_DEFAULT_GATEWAY_CONNECTION_SLUG,
  'xiaomi-default',
])

export function isManagedDefaultGatewayConnection(connectionSlug: string | null | undefined): boolean {
  return !!connectionSlug && MANAGED_GATEWAY_CONNECTION_SLUGS.has(connectionSlug)
}

export function normalizeManagedDefaultGatewayAuthError(
  error: TypedError,
  connectionSlug: string | null | undefined,
): TypedError {
  if (!isManagedDefaultGatewayConnection(connectionSlug) || error.code !== 'invalid_api_key') {
    return error
  }

  return {
    ...error,
    code: 'expired_oauth_token',
    title: 'AI Access Unavailable',
    message: 'Your app session cannot access the default AI service. Sign in again or contact support if this keeps happening.',
    actions: [
      {
        key: 'r',
        label: 'Sign in again',
        action: 'reauth',
      },
    ],
    canRetry: false,
    details: undefined,
    originalError: undefined,
  }
}
