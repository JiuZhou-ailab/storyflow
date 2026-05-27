// input: Feishu OAuth configuration, Feishu user claims, and optional Postgres registration storage.
// output: Web UI Feishu login URL generation, OAuth callback completion, and access decisions.
// pos: Authentication boundary for company-internal Feishu SSO and external account registration checks.

import { createHash, randomBytes } from 'node:crypto'

const DEFAULT_FEISHU_AUTH_BASE_URL = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize'
const DEFAULT_FEISHU_API_BASE_URL = 'https://open.feishu.cn'
const DEFAULT_STATE_TTL_MS = 5 * 60 * 1000

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
type SqlLike = Bun.SQL

export interface FeishuUserInfo {
  openId: string
  unionId?: string
  userId?: string
  tenantKey?: string
  email?: string
  enterpriseEmail?: string
  name?: string
  avatarUrl?: string
}

export interface FeishuRegistrationStore {
  isRegistered: (user: FeishuUserInfo) => Promise<boolean>
  recordLoginAttempt?: (input: {
    user: FeishuUserInfo
    status: FeishuLoginDecision['reason']
  }) => Promise<void>
}

export interface FeishuOAuthClient {
  exchangeCode: (input: {
    code: string
    redirectUri: string
    codeVerifier: string
  }) => Promise<{ accessToken: string }>
  getUserInfo: (accessToken: string) => Promise<FeishuUserInfo>
}

export interface FeishuAuthConfig {
  appId: string
  appSecret: string
  internalTenantKeys: string[]
  allowAllUsers?: boolean
  redirectUri?: string
  scope?: string
  authBaseUrl?: string
  apiBaseUrl?: string
  fetch?: FetchLike
  client?: FeishuOAuthClient
  registrationStore?: FeishuRegistrationStore
}

export type FeishuLoginDecision =
  | { allowed: true, reason: 'internal' | 'registered' | 'feishu-account', user: FeishuUserInfo }
  | { allowed: false, reason: 'registration-required', user: FeishuUserInfo }

export interface BuildFeishuAuthorizeUrlInput {
  appId: string
  redirectUri: string
  state: string
  codeChallenge: string
  scope?: string
  authBaseUrl?: string
}

export function buildFeishuAuthorizeUrl(input: BuildFeishuAuthorizeUrlInput): string {
  const url = new URL(input.authBaseUrl ?? DEFAULT_FEISHU_AUTH_BASE_URL)
  url.searchParams.set('client_id', input.appId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', input.state)
  url.searchParams.set('code_challenge', input.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')

  const scope = input.scope?.trim()
  if (scope) {
    url.searchParams.set('scope', scope)
  }

  return url.toString()
}

export interface FeishuOAuthState {
  state: string
  codeVerifier: string
  codeChallenge: string
  redirectUri: string
  expiresAt: number
}

export class FeishuOAuthStateStore {
  private readonly states = new Map<string, FeishuOAuthState>()

  constructor(private readonly ttlMs = DEFAULT_STATE_TTL_MS) {}

  create(redirectUri: string): FeishuOAuthState {
    this.cleanup()

    const codeVerifier = base64Url(randomBytes(32))
    const state = base64Url(randomBytes(24))
    const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest())
    const entry = {
      state,
      codeVerifier,
      codeChallenge,
      redirectUri,
      expiresAt: Date.now() + this.ttlMs,
    }

    this.states.set(state, entry)
    return entry
  }

  consume(state: string): FeishuOAuthState | null {
    const entry = this.states.get(state)
    if (!entry) return null

    this.states.delete(state)
    if (entry.expiresAt <= Date.now()) return null
    return entry
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [state, entry] of this.states) {
      if (entry.expiresAt <= now) {
        this.states.delete(state)
      }
    }
  }
}

export async function decideFeishuLoginAccess(input: {
  user: FeishuUserInfo
  internalTenantKeys: string[]
  allowAllUsers?: boolean
  registrationStore?: FeishuRegistrationStore
}): Promise<FeishuLoginDecision> {
  const internalTenants = new Set(input.internalTenantKeys.map((key) => key.trim()).filter(Boolean))

  if (input.user.tenantKey && internalTenants.has(input.user.tenantKey)) {
    return { allowed: true, reason: 'internal', user: input.user }
  }

  const isRegistered = input.registrationStore
    ? await input.registrationStore.isRegistered(input.user)
    : false

  if (isRegistered) {
    return { allowed: true, reason: 'registered', user: input.user }
  }

  if (input.allowAllUsers === true) {
    return { allowed: true, reason: 'feishu-account', user: input.user }
  }

  return { allowed: false, reason: 'registration-required', user: input.user }
}

export class DefaultFeishuOAuthClient implements FeishuOAuthClient {
  private readonly appId: string
  private readonly appSecret: string
  private readonly apiBaseUrl: string
  private readonly fetchImpl: FetchLike

  constructor(config: {
    appId: string
    appSecret: string
    apiBaseUrl?: string
    fetch?: FetchLike
  }) {
    this.appId = config.appId
    this.appSecret = config.appSecret
    this.apiBaseUrl = config.apiBaseUrl ?? DEFAULT_FEISHU_API_BASE_URL
    this.fetchImpl = config.fetch ?? fetch
  }

  async exchangeCode(input: {
    code: string
    redirectUri: string
    codeVerifier: string
  }): Promise<{ accessToken: string }> {
    const res = await this.fetchImpl(`${this.apiBaseUrl}/open-apis/authen/v2/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: this.appId,
        client_secret: this.appSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
      }),
    })
    const body = await parseJsonObject(res)

    if (!res.ok) {
      throw new Error(formatFeishuError('Feishu token exchange failed', body, res.status))
    }

    const token = readString(body, ['access_token', 'user_access_token'])
      ?? readString(readObject(body, ['data']), ['access_token', 'user_access_token'])
    if (!token) {
      throw new Error('Feishu token exchange response did not include access_token')
    }

    return { accessToken: token }
  }

  async getUserInfo(accessToken: string): Promise<FeishuUserInfo> {
    const res = await this.fetchImpl(`${this.apiBaseUrl}/open-apis/authen/v1/user_info`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const body = await parseJsonObject(res)

    if (!res.ok) {
      throw new Error(formatFeishuError('Feishu user info request failed', body, res.status))
    }

    return normalizeFeishuUserInfo(readObject(body, ['data']) ?? body)
  }
}

export class FeishuLoginService {
  private readonly config: FeishuAuthConfig
  private readonly stateStore: FeishuOAuthStateStore
  private readonly client: FeishuOAuthClient

  constructor(config: FeishuAuthConfig, stateStore = new FeishuOAuthStateStore()) {
    this.config = config
    this.stateStore = stateStore
    this.client = config.client ?? new DefaultFeishuOAuthClient({
      appId: config.appId,
      appSecret: config.appSecret,
      apiBaseUrl: config.apiBaseUrl,
      fetch: config.fetch,
    })
  }

  isConfigured(): boolean {
    return this.config.appId.trim().length > 0 && this.config.appSecret.trim().length > 0
  }

  startLogin(defaultRedirectUri: string): { authUrl: string } {
    if (!this.isConfigured()) {
      throw new Error('Feishu login is not configured')
    }

    const redirectUri = this.config.redirectUri || defaultRedirectUri
    const state = this.stateStore.create(redirectUri)
    return {
      authUrl: buildFeishuAuthorizeUrl({
        appId: this.config.appId,
        redirectUri,
        state: state.state,
        codeChallenge: state.codeChallenge,
        scope: this.config.scope,
        authBaseUrl: this.config.authBaseUrl,
      }),
    }
  }

  async completeLogin(input: {
    code: string
    state: string
  }): Promise<FeishuLoginDecision> {
    const state = this.stateStore.consume(input.state)
    if (!state) {
      throw new Error('Invalid or expired Feishu OAuth state')
    }

    return this.exchangeCodeForDecision({
      code: input.code,
      redirectUri: state.redirectUri,
      codeVerifier: state.codeVerifier,
    })
  }

  async exchangeCodeForDecision(input: {
    code: string
    redirectUri: string
    codeVerifier: string
  }): Promise<FeishuLoginDecision> {
    const token = await this.client.exchangeCode(input)
    const user = await this.client.getUserInfo(token.accessToken)
    const decision = await decideFeishuLoginAccess({
      user,
      internalTenantKeys: this.config.internalTenantKeys,
      allowAllUsers: this.config.allowAllUsers,
      registrationStore: this.config.registrationStore,
    })

    await this.config.registrationStore?.recordLoginAttempt?.({
      user,
      status: decision.reason,
    })

    return decision
  }
}

export class PostgresFeishuRegistrationStore implements FeishuRegistrationStore {
  private schemaReady: Promise<void> | null = null

  constructor(private readonly sql: SqlLike) {}

  async isRegistered(user: FeishuUserInfo): Promise<boolean> {
    await this.ensureSchema()

    const openId = user.openId || null
    const unionId = user.unionId || null
    const userId = user.userId || null
    const email = normalizeEmail(user.email)
    const enterpriseEmail = normalizeEmail(user.enterpriseEmail)

    const rows = await this.sql`
      select subject_key
      from webui_feishu_users
      where provider = 'feishu'
        and status = 'active'
        and (
          (${openId} is not null and open_id = ${openId})
          or (${unionId} is not null and union_id = ${unionId})
          or (${userId} is not null and user_id = ${userId})
          or (${email} is not null and lower(email) = ${email})
          or (${enterpriseEmail} is not null and lower(enterprise_email) = ${enterpriseEmail})
        )
      limit 1
    `

    return rows.length > 0
  }

  async recordLoginAttempt(input: {
    user: FeishuUserInfo
    status: FeishuLoginDecision['reason']
  }): Promise<void> {
    await this.ensureSchema()

    const user = input.user
    const subjectKey = getSubjectKey(user)
    const status = input.status === 'registered' || input.status === 'feishu-account'
      ? 'active'
      : input.status === 'internal'
        ? 'internal'
        : 'pending'

    await this.sql`
      insert into webui_feishu_users (
        subject_key,
        provider,
        open_id,
        union_id,
        user_id,
        tenant_key,
        email,
        enterprise_email,
        name,
        avatar_url,
        status,
        registered_at,
        last_login_at,
        created_at,
        updated_at
      ) values (
        ${subjectKey},
        'feishu',
        ${user.openId || null},
        ${user.unionId || null},
        ${user.userId || null},
        ${user.tenantKey || null},
        ${normalizeEmail(user.email)},
        ${normalizeEmail(user.enterpriseEmail)},
        ${user.name || null},
        ${user.avatarUrl || null},
        ${status},
        case when ${status} = 'active' then current_timestamp else null end,
        current_timestamp,
        current_timestamp,
        current_timestamp
      )
      on conflict (subject_key) do update set
        open_id = coalesce(excluded.open_id, webui_feishu_users.open_id),
        union_id = coalesce(excluded.union_id, webui_feishu_users.union_id),
        user_id = coalesce(excluded.user_id, webui_feishu_users.user_id),
        tenant_key = coalesce(excluded.tenant_key, webui_feishu_users.tenant_key),
        email = coalesce(excluded.email, webui_feishu_users.email),
        enterprise_email = coalesce(excluded.enterprise_email, webui_feishu_users.enterprise_email),
        name = coalesce(excluded.name, webui_feishu_users.name),
        avatar_url = coalesce(excluded.avatar_url, webui_feishu_users.avatar_url),
        status = case
          when webui_feishu_users.status = 'active' then 'active'
          when excluded.status = 'active' then 'active'
          else excluded.status
        end,
        registered_at = case
          when webui_feishu_users.registered_at is not null then webui_feishu_users.registered_at
          when excluded.status = 'active' then current_timestamp
          else null
        end,
        last_login_at = current_timestamp,
        updated_at = current_timestamp
    `
  }

  private ensureSchema(): Promise<void> {
    this.schemaReady ??= this.createSchema()
    return this.schemaReady
  }

  private async createSchema(): Promise<void> {
    await this.sql`
      create table if not exists webui_feishu_users (
        subject_key text primary key,
        provider text not null default 'feishu',
        open_id text,
        union_id text,
        user_id text,
        tenant_key text,
        email text,
        enterprise_email text,
        name text,
        avatar_url text,
        status text not null default 'pending',
        registered_at timestamp with time zone,
        last_login_at timestamp with time zone,
        created_at timestamp with time zone not null default current_timestamp,
        updated_at timestamp with time zone not null default current_timestamp
      )
    `
    await this.sql`
      create unique index if not exists webui_feishu_users_open_id_idx
      on webui_feishu_users(provider, open_id)
      where open_id is not null
    `
    await this.sql`
      create unique index if not exists webui_feishu_users_union_id_idx
      on webui_feishu_users(provider, union_id)
      where union_id is not null
    `
    await this.sql`
      create index if not exists webui_feishu_users_email_idx
      on webui_feishu_users(provider, lower(email))
      where email is not null
    `
    await this.sql`
      create index if not exists webui_feishu_users_enterprise_email_idx
      on webui_feishu_users(provider, lower(enterprise_email))
      where enterprise_email is not null
    `
  }
}

export function createPostgresFeishuRegistrationStore(databaseUrl: string | undefined): FeishuRegistrationStore | undefined {
  if (!databaseUrl?.trim()) return undefined
  return new PostgresFeishuRegistrationStore(new Bun.SQL(databaseUrl.trim()))
}

function normalizeFeishuUserInfo(raw: Record<string, unknown>): FeishuUserInfo {
  const openId = readString(raw, ['open_id', 'openId'])
  if (!openId) {
    throw new Error('Feishu user info response did not include open_id')
  }

  return {
    openId,
    unionId: readString(raw, ['union_id', 'unionId']),
    userId: readString(raw, ['user_id', 'userId']),
    tenantKey: readString(raw, ['tenant_key', 'tenantKey']),
    email: readString(raw, ['email']),
    enterpriseEmail: readString(raw, ['enterprise_email', 'enterpriseEmail']),
    name: readString(raw, ['name', 'en_name', 'display_name']),
    avatarUrl: readString(raw, ['avatar_url', 'avatarUrl']),
  }
}

function readObject(value: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const candidate = value[key]
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return candidate as Record<string, unknown>
    }
  }
  return null
}

function readString(value: Record<string, unknown> | null, keys: string[]): string | undefined {
  if (!value) return undefined

  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return undefined
}

async function parseJsonObject(res: Response): Promise<Record<string, unknown>> {
  const body = await res.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {}
  }
  return body as Record<string, unknown>
}

function formatFeishuError(prefix: string, body: Record<string, unknown>, status: number): string {
  const message = readString(body, ['msg', 'message', 'error_description', 'error'])
  return message ? `${prefix}: ${message}` : `${prefix}: HTTP ${status}`
}

function normalizeEmail(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase()
  return normalized || null
}

function getSubjectKey(user: FeishuUserInfo): string {
  if (user.openId) return `open_id:${user.openId}`
  if (user.unionId) return `union_id:${user.unionId}`
  if (user.userId) return `user_id:${user.userId}`

  const email = normalizeEmail(user.enterpriseEmail) ?? normalizeEmail(user.email)
  if (email) return `email:${email}`

  throw new Error('Feishu user info did not include a stable subject identifier')
}

function base64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}
