// input: Typed provider auth errors and session LLM connection slug
// output: User-facing managed-gateway auth errors that hide API-key setup details
// pos: Session error normalization boundary for bundled default AI access

import type { TypedError } from '@craft-agent/core/types'
import {
  MANAGED_LLM_CONNECTION_SLUG,
  normalizeLlmConnectionSlug,
} from '@craft-agent/shared/config'

export const MANAGED_MODEL_ACCESS_UNAVAILABLE_MESSAGE =
  'Default AI access is unavailable on shared or remote servers. Use the local desktop runtime or configure a custom provider.'

export function isManagedDefaultGatewayConnection(
  connectionSlug: string | null | undefined,
): connectionSlug is string {
  return !!connectionSlug
    && normalizeLlmConnectionSlug(connectionSlug) === MANAGED_LLM_CONNECTION_SLUG
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
    code: 'invalid_api_key',
    title: 'Default AI Access Interrupted',
    message: 'Default AI access could not be refreshed automatically. Retry this message; if sign-in appears, sign in again.',
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
