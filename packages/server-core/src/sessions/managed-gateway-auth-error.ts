// input: Typed provider/auth errors, safe access diagnostics and session connection slug
// output: User-facing managed-access recovery with safe diagnostic references
// pos: Session error normalization boundary for bundled default AI access

import { isAccessReason } from '@craft-agent/shared/auth/managed-access'
import type { TypedError } from '@craft-agent/core/types'
import { isManagedLlmConnectionSlug } from '@craft-agent/shared/config'

export const MANAGED_MODEL_ACCESS_UNAVAILABLE_MESSAGE =
  'Default AI access is unavailable on shared or remote servers. Use the local desktop runtime or configure a custom provider.'

export function isManagedDefaultGatewayConnection(
  connectionSlug: string | null | undefined,
): connectionSlug is string {
  return !!connectionSlug && isManagedLlmConnectionSlug(connectionSlug)
}

export function normalizeManagedDefaultGatewayAuthError(
  error: TypedError,
  connectionSlug: string | null | undefined,
): TypedError {
  if (!isManagedDefaultGatewayConnection(connectionSlug)) return error
  const diagnostic = readAccessDiagnostic(error.originalError)
  if (diagnostic) {
    const denied = ['account_disabled', 'scope_denied', 'model_denied'].includes(diagnostic.reason)
    const signIn = ['session_revoked', 'legacy_session'].includes(diagnostic.reason)
    const unavailable = diagnostic.reason === 'dependency_unavailable'
    const canRetry = unavailable || diagnostic.reason === 'token_expired'
    return { ...error, code: signIn || diagnostic.reason === 'token_expired' ? 'invalid_api_key' : 'service_error',
      title: denied ? 'Default AI Access Denied' : signIn ? 'Sign In Required' : 'Default AI Access Interrupted',
      message: denied ? 'Your access to this capability has been removed. Contact your administrator.'
        : signIn ? 'This session is no longer valid. Sign in again to restore access.'
          : unavailable ? 'The access service is temporarily unavailable. Try again later.'
            : diagnostic.reason === 'token_expired' ? 'Access expired. Retry this message to use renewed access.'
              : 'Access could not be verified. Contact support with the diagnostic reference.',
      canRetry, actions: canRetry ? [{ key: 'r', label: 'Retry', action: 'retry' }] : [],
      details: diagnostic.correlation_id ? ['Reference: ' + diagnostic.correlation_id] : undefined,
      originalError: JSON.stringify(diagnostic),
    }
  }
  if (error.code !== 'invalid_api_key') {
    return error
  }

  return {
    ...error,
    code: 'invalid_api_key',
    title: 'Default AI Access Interrupted',
    message: 'Default AI access was interrupted. Retry this message; if sign-in appears, sign in again.',
    actions: [
      {
        key: 'r',
        label: 'Retry',
        action: 'retry',
      },
    ],
    canRetry: true,
    details: undefined,
    originalError: undefined,
  }
}

// Only the published, bounded diagnostic fields survive user-facing normalization.
function readAccessDiagnostic(raw: string | undefined): { code: string; reason: string; stage: string; correlation_id?: string } | undefined {
  if (!raw) return undefined
  try {
    const value = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
    if (!['client_session_token_invalid', 'model_access_token_invalid', 'tool_access_token_invalid', 'managed_access_denied', 'authorization_dependency_unavailable'].includes(value.code)) return undefined
    if (!isAccessReason(value.reason)) return undefined
    if (!['identity', 'model', 'tool'].includes(value.stage)) return undefined
    return { code: value.code, reason: value.reason, stage: value.stage,
      ...(typeof value.correlation_id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value.correlation_id) ? { correlation_id: value.correlation_id } : {}),
    }
  } catch { return undefined }
}
