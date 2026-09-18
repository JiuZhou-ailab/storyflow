// input: Verified identity claims and an internal authorization binding
// output: Current access decisions and safe, correlated HTTP failures
// pos: Shared contract between the Auth Broker and managed resource gateways
export const ACCESS_REASONS = ['legacy_session', 'session_revoked', 'account_disabled',
  'scope_denied', 'model_denied', 'dependency_unavailable', 'token_missing',
  'token_expired', 'unknown_signing_key', 'invalid_token'] as const
export type AccessReason = typeof ACCESS_REASONS[number]
export function isAccessReason(value: unknown): value is AccessReason {
  return typeof value === 'string' && (ACCESS_REASONS as readonly string[]).includes(value)
}

export class ManagedAccessError extends Error {
  constructor(readonly reason: AccessReason) { super(reason) }
}

export interface AccessIdentity { sub: string; sid?: string }
export interface AccessPolicy { scopes: string[]; models: string[] | null }
export interface AccessDecision { policy?: AccessPolicy; reason?: AccessReason }
export interface AccessBinding {
  authorize(identity: AccessIdentity, scope?: string, model?: string): Promise<AccessDecision>
}
export interface AccessEnvironment {
  /** Migration only: legacy disables current-state checks; required is the safe default. */
  STORYFLOW_ACCESS_ENFORCEMENT?: string
  ACCESS_AUTHORITY?: AccessBinding
}

export function accessRequired(env: AccessEnvironment): boolean {
  return env.STORYFLOW_ACCESS_ENFORCEMENT !== 'legacy'
}

export async function accessAuthorityReady(env: AccessEnvironment): Promise<boolean> {
  if (!accessRequired(env)) return true
  try {
    const result = await env.ACCESS_AUTHORITY?.authorize({ sub: 'readiness', sid: 'readiness' })
    return result?.reason === 'session_revoked'
  } catch { return false }
}

export async function currentAccess(env: AccessEnvironment, identity: AccessIdentity, scope?: string, model?: string): Promise<AccessPolicy | undefined> {
  if (!accessRequired(env)) return undefined
  if (!identity.sid) throw new ManagedAccessError('legacy_session')
  if (typeof identity.sid !== 'string' || identity.sid.length > 128) throw new ManagedAccessError('invalid_token')
  let decision: AccessDecision
  try {
    if (!env.ACCESS_AUTHORITY) throw new Error('Missing authorization binding')
    decision = await env.ACCESS_AUTHORITY.authorize(identity, scope, model)
  } catch { throw new ManagedAccessError('dependency_unavailable') }
  if (decision.reason) throw new ManagedAccessError(decision.reason)
  if (!decision.policy) throw new ManagedAccessError('dependency_unavailable')
  return decision.policy
}

export function tokenFailure(error: unknown): AccessReason {
  const code = (error as { code?: string })?.code
  if (code === 'ERR_JWT_EXPIRED') return 'token_expired'
  if (error instanceof Error && /key.*(unknown|required)/i.test(error.message)) return 'unknown_signing_key'
  return 'invalid_token'
}

export function accessFailure(reason: AccessReason, stage: 'identity' | 'model' | 'tool', context?: { correlation_id?: string; model_call_id?: string; attempt?: number; correlation_version?: number; retry_index?: number }, format: 'legacy' | 'sdk' = 'legacy'): Response {
  const status = reason === 'dependency_unavailable' ? 503
    : ['account_disabled', 'scope_denied', 'model_denied'].includes(reason) ? 403 : 401
  const correlationId = context?.correlation_id && /^[a-zA-Z0-9-]{1,80}$/.test(context.correlation_id) ? context.correlation_id : crypto.randomUUID()
  console.warn(JSON.stringify({ ...context, event: 'managed_access_denied', stage, reason, status, correlation_id: correlationId }))
  const code = status === 503 ? 'authorization_dependency_unavailable'
    : status === 403 ? 'managed_access_denied'
      : stage === 'identity' ? 'client_session_token_invalid'
        : stage === 'model' ? 'model_access_token_invalid' : 'tool_access_token_invalid'
  const message = status === 503 ? 'Access service temporarily unavailable'
    : status === 403 ? 'Managed access permission denied' : 'Authentication required'
  const diagnostic = {
    code, reason, stage, correlation_id: correlationId, retryable: status === 503,
    recovery: status === 503 ? 'retry' : status === 403 ? 'contact_operator'
      : ['session_revoked', 'legacy_session'].includes(reason) || stage === 'identity' ? 'sign_in' : 'refresh_next_operation',
  }
  // Opted-in model SDKs retain error objects, but discard siblings of error strings.
  // Top-level fields remain available to direct HTTP consumers and older clients.
  return Response.json({ error: format === 'sdk' ? { message, ...diagnostic } : message, ...diagnostic }, { status })
}
