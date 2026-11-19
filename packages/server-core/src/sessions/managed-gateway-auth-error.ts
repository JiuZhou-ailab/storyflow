// input: Typed provider/auth errors, safe access diagnostics, session connection slug and an observed capability renewal
// output: One user-facing managed-access recovery (resend, sign in, access removed, wait) with safe diagnostic references
// pos: Session error normalization boundary for bundled default AI access

import {
  isAccessReason,
  type AccessReason,
  type ManagedAccessRecovery,
} from '@craft-agent/shared/auth/managed-access'
import { setupI18n } from '@craft-agent/shared/i18n'
import type { TypedError } from '@craft-agent/core/types'
import { isManagedLlmConnectionSlug } from '@craft-agent/shared/config'

export const MANAGED_MODEL_ACCESS_UNAVAILABLE_MESSAGE =
  'Default AI access is unavailable on shared or remote servers. Use the local desktop runtime or configure a custom provider.'

export function isManagedDefaultGatewayConnection(
  connectionSlug: string | null | undefined,
): connectionSlug is string {
  return !!connectionSlug && isManagedLlmConnectionSlug(connectionSlug)
}

/** Published gateway diagnostic fields that may be persisted with a user-facing error. */
export interface ManagedAccessDiagnostic { code: string; reason: AccessReason; stage: string; correlation_id?: string }

/** Observed outcome of one forced capability renewal for the next explicit operation. */
export interface ManagedAccessRenewal { recovery: ManagedAccessRecovery; reason?: AccessReason; correlationId?: string }

const ACCESS_REMOVED_REASONS: ReadonlySet<AccessReason> = new Set(['account_disabled', 'scope_denied', 'model_denied'])
const SIGN_IN_REASONS: ReadonlySet<AccessReason> = new Set(['session_revoked', 'legacy_session'])

/**
 * Resolve a managed gateway rejection into one recovery the user can act on.
 *
 * Permission and dependency rejections are final and never renew. Identity/token
 * rejections renew the capability once for the next explicit operation, and the
 * message reports that observed outcome instead of asking the user to guess.
 * Nothing here replays the failed message or retries the model call.
 */
export async function normalizeManagedDefaultGatewayAuthError(
  error: TypedError,
  connectionSlug: string | null | undefined,
  renew: () => Promise<ManagedAccessRenewal>,
): Promise<TypedError> {
  if (!isManagedDefaultGatewayConnection(connectionSlug)) return error
  const diagnostic = readAccessDiagnostic(error.originalError)
  if (diagnostic && ACCESS_REMOVED_REASONS.has(diagnostic.reason)) {
    return presentManagedAccessRecovery('access_removed', { diagnostic }, error)
  }
  if (diagnostic?.reason === 'dependency_unavailable') {
    return presentManagedAccessRecovery('service_unavailable', { diagnostic }, error)
  }
  if (!diagnostic && error.code !== 'invalid_api_key' && error.code !== 'expired_oauth_token') return error

  const renewal = await renew()
  // A gateway that explicitly revoked the session outranks a racing renewal result.
  const recovery = diagnostic && SIGN_IN_REASONS.has(diagnostic.reason) ? 'sign_in' : renewal.recovery
  return presentManagedAccessRecovery(recovery, { diagnostic, renewal }, error)
}

/** Build the persisted, localized error for a known managed-access recovery. */
export function presentManagedAccessRecovery(
  recovery: ManagedAccessRecovery,
  evidence: { diagnostic?: ManagedAccessDiagnostic; renewal?: ManagedAccessRenewal },
  base?: TypedError,
): TypedError {
  const i18n = setupI18n()
  const { diagnostic, renewal } = evidence
  // Literal keys keep these strings visible to the i18n coverage check.
  const copy: Record<ManagedAccessRecovery, () => [title: string, message: string]> = {
    retry: () => [i18n.t('errors.managedAccessRenewedTitle'), i18n.t('errors.managedAccessRenewed')],
    sign_in: () => [i18n.t('errors.managedAccessSignInTitle'), i18n.t('errors.managedAccessSignIn')],
    access_removed: () => [i18n.t('errors.managedAccessRemovedTitle'), i18n.t('errors.managedAccessRemoved')],
    service_unavailable: () => [i18n.t('errors.managedAccessUnavailableTitle'), i18n.t('errors.managedAccessUnavailable')],
  }
  const [title, message] = copy[recovery]()
  const canRetry = recovery === 'retry' || recovery === 'service_unavailable'
  const reference = diagnostic?.correlation_id ?? renewal?.correlationId
  // Keep only bounded, token-free evidence so support can match the user-visible error to trusted logs.
  const evidenceRecord = {
    ...diagnostic,
    ...(renewal ? {
      renewal: renewal.recovery,
      ...(renewal.reason ? { renewal_reason: renewal.reason } : {}),
      ...(renewal.correlationId ? { renewal_correlation_id: renewal.correlationId } : {}),
    } : {}),
  }
  // Recovery is always an explicit user action; never leave an automatic-retry delay behind.
  const inherited: Partial<TypedError> = { ...base }
  delete inherited.retryDelayMs
  return {
    ...inherited,
    code: recovery === 'retry' || recovery === 'sign_in' ? 'invalid_api_key' : 'service_error',
    title,
    message,
    actions: canRetry ? [{ key: 'r', label: i18n.t('common.retry'), action: 'retry' }] : [],
    canRetry,
    details: reference ? [i18n.t('errors.managedAccessReference', { reference })] : undefined,
    originalError: JSON.stringify(evidenceRecord),
  }
}

// Only the published, bounded diagnostic fields survive user-facing normalization.
function readAccessDiagnostic(raw: string | undefined): ManagedAccessDiagnostic | undefined {
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
