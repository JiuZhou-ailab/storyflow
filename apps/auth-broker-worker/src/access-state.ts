// input: D1 primary state, verified subjects/sessions, and explicit operator changes
// output: Durable sessions and current access decisions
// pos: Auth Broker's sole owner of managed account/session authorization
import type { D1Database } from '@cloudflare/workers-types'
import { ManagedAccessError, type AccessDecision, type AccessIdentity, type AccessPolicy } from '../../../packages/shared/src/auth/managed-access'

export const DEFAULT_ACCESS_SCOPES = ['model:chat', 'model:video', 'catalog:read', 'web:search', 'web:scrape', 'skills:read', 'skills:publish']
export interface AccessStateEnv { ACCESS_DB?: D1Database }

export async function accessStateReady(env: AccessStateEnv): Promise<boolean> {
  try {
    await database(env).prepare('SELECT s.revoked_by, a.updated_by FROM access_sessions s JOIN access_accounts a ON a.subject = s.subject LIMIT 0').all()
    return true
  } catch { return false }
}

function database(env: AccessStateEnv) {
  if (!env.ACCESS_DB) throw new ManagedAccessError('dependency_unavailable')
  return env.ACCESS_DB.withSession('first-primary')
}

async function stateIO<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation() }
  catch (error) {
    if (error instanceof ManagedAccessError) throw error
    throw new ManagedAccessError('dependency_unavailable')
  }
}

export async function authorizeAccess(env: AccessStateEnv, identity: AccessIdentity, scope?: string, model?: string): Promise<AccessDecision> {
  try {
    const policy = await readAccess(env, identity)
    if (scope && !policy.scopes.includes(scope)) throw new ManagedAccessError('scope_denied')
    if (model && policy.models !== null && !policy.models.includes(model)) throw new ManagedAccessError('model_denied')
    return { policy }
  } catch (error) {
    return { reason: error instanceof ManagedAccessError ? error.reason : 'dependency_unavailable' }
  }
}

export async function readAccess(env: AccessStateEnv, identity: AccessIdentity): Promise<AccessPolicy> {
  if (!identity.sid) throw new ManagedAccessError('legacy_session')
  return stateIO(async () => {
    const startedAt = Date.now()
    const result = await database(env).prepare(`SELECT a.enabled, a.scopes, a.models, s.revoked_at, s.expires_at
      FROM access_sessions s JOIN access_accounts a ON a.subject = s.subject WHERE s.sid = ? AND s.subject = ?`)
      .bind(identity.sid, identity.sub).all<{ enabled: number; scopes: string; models: string | null; revoked_at: number | null; expires_at: number }>()
    console.log(JSON.stringify({ event: 'managed_access_state_read', duration_ms: Date.now() - startedAt, queries: 1, rows_read: result.meta.rows_read }))
    const row = result.results[0]
    if (!row) throw new ManagedAccessError('session_revoked')
    if (!row.enabled) throw new ManagedAccessError('account_disabled')
    if (row.revoked_at !== null || row.expires_at <= Math.floor(Date.now() / 1000)) throw new ManagedAccessError('session_revoked')
    return { scopes: JSON.parse(row.scopes), models: row.models === null ? null : JSON.parse(row.models) }
  })
}

export async function openAccessSession(env: AccessStateEnv, subject: string, authenticatedAt: number, expiresAt: number): Promise<string> {
  return stateIO(async () => {
    const db = database(env)
    const sid = crypto.randomUUID()
    await db.batch([
      db.prepare('INSERT INTO access_accounts(subject, scopes, updated_at) VALUES (?, ?, ?) ON CONFLICT(subject) DO NOTHING')
        .bind(subject, JSON.stringify(DEFAULT_ACCESS_SCOPES), authenticatedAt),
      db.prepare(`INSERT INTO access_sessions(sid, subject, authenticated_at, expires_at)
        SELECT ?, subject, ?, ? FROM access_accounts WHERE subject = ? AND enabled = 1`)
        .bind(sid, authenticatedAt, expiresAt, subject),
    ])
    // An absent row after a concurrent disable cannot be signed into a usable session.
    const account = await db.prepare('SELECT enabled FROM access_accounts WHERE subject = ?').bind(subject).first<{ enabled: number }>()
    if (!account?.enabled) throw new ManagedAccessError('account_disabled')
    await readAccess(env, { sub: subject, sid })
    return sid
  })
}

export async function revokeAccessSession(env: AccessStateEnv, identity: AccessIdentity): Promise<void> {
  if (!identity.sid) throw new ManagedAccessError('legacy_session')
  await stateIO(async () => {
    const db = database(env)
    const now = Math.floor(Date.now() / 1000)
    await db.prepare('UPDATE access_sessions SET revoked_at = ?, revoked_by = ? WHERE sid = ? AND subject = ? AND revoked_at IS NULL')
      .bind(now, identity.sub, identity.sid, identity.sub).run()
  })
}

/** One SQL statement: database triggers commit revocation and audit with the change. */
export function accessChange(operation: string, target: string, actor: string, value?: string): { sql: string; params: (string | number | null)[] } {
  if (!target || target.length > 512 || !actor || actor.length > 512) throw new Error('Bounded target and operator identity are required')
  if (operation === 'revoke-session' || operation === 'revoke-all') return {
    sql: `UPDATE access_sessions SET revoked_at = unixepoch(), revoked_by = ? WHERE ${operation === 'revoke-session' ? 'sid' : 'subject'} = ? AND revoked_at IS NULL RETURNING sid`,
    params: [actor, target],
  }
  if (operation === 'enable' || operation === 'disable') return {
    sql: 'UPDATE access_accounts SET enabled = ?, updated_at = unixepoch(), updated_by = ? WHERE subject = ? RETURNING subject',
    params: [operation === 'enable' ? 1 : 0, actor, target],
  }
  if (!['scopes', 'models'].includes(operation) || value === undefined) throw new Error('Expected enable, disable, revoke-session, revoke-all, scopes or models')
  const values = value === '' ? [] : value.split(',')
  if (values.length > 100 || values.some(value => !/^[a-zA-Z0-9:._/-]{1,128}$/.test(value))) throw new Error('Invalid permission list')
  if (operation === 'scopes' && values.some(scope => !DEFAULT_ACCESS_SCOPES.includes(scope))) throw new Error('Unknown capability')
  return {
    sql: `UPDATE access_accounts SET ${operation} = ?, updated_at = unixepoch(), updated_by = ? WHERE subject = ? RETURNING subject`,
    params: [operation === 'models' && value === 'all' ? null : JSON.stringify([...new Set(values)]), actor, target],
  }
}
