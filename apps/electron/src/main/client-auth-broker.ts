// input: Auth broker URLs, provider credentials, and broker JSON responses
// output: Bounded HTTPS broker exchanges and normalized desktop auth capabilities
// pos: Main-process network trust boundary beneath the client auth service

import type {
  ClientAuthBrokerClient,
  ClientAuthBrokerExchangeInput,
  ClientAuthBrokerExchangeResult,
  ClientAuthBrokerTokenRefreshInput,
  ClientAuthBrokerTokenRefreshResult,
  ClientAuthBrokerMarketTokenResult,
  ClientAuthNeonBrokerExchangeInput,
  ClientAuthUser,
  ClientFeishuBrokerAuthConfig,
  ClientFeishuBrokerPublicConfig,
} from './client-auth'

const DEFAULT_NEON_BROKER_EXCHANGE_PATH = '/api/client-auth/neon/exchange'
const DEFAULT_FEISHU_BROKER_CONFIG_PATH = '/api/client-auth/feishu/config'
const DEFAULT_FEISHU_BROKER_EXCHANGE_PATH = '/api/client-auth/feishu/exchange'
const DEFAULT_CLIENT_AUTH_TOKEN_PATH = '/api/client-auth/token'
const DEFAULT_SKILLS_MARKET_TOKEN_PATH = '/api/client-auth/skills-market/token'
const DEFAULT_AUTH_BROKER_REQUEST_TIMEOUT_MS = 15_000

export function normalizeClientAuthBrokerUrl(value: string): string {
  const url = new URL(value)
  const loopbackHttp = url.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !loopbackHttp) {
    throw new Error('Client auth broker URL must use HTTPS, except for loopback development')
  }
  if (url.username || url.password) {
    throw new Error('Client auth broker URL must not contain credentials')
  }
  return url.toString().replace(/\/+$/, '')
}

export class ClientAuthBrokerHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ClientAuthBrokerHttpError'
  }
}

export class DefaultClientAuthBrokerClient implements ClientAuthBrokerClient {
  constructor(private readonly requestTimeoutMs = DEFAULT_AUTH_BROKER_REQUEST_TIMEOUT_MS) {}

  async getFeishuAuthConfig(input: { brokerUrl: string }): Promise<ClientFeishuBrokerPublicConfig | null> {
    const endpoint = buildBrokerEndpointUrl(input.brokerUrl, DEFAULT_FEISHU_BROKER_CONFIG_PATH)
    const body = await requestBrokerJson(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    }, 'Feishu broker config request failed', { allowNotFound: true })

    return body ? normalizeFeishuBrokerPublicConfig(body) : null
  }

  async exchangeNeonToken(input: ClientAuthNeonBrokerExchangeInput): Promise<ClientAuthBrokerExchangeResult> {
    const endpoint = buildBrokerEndpointUrl(input.brokerUrl, DEFAULT_NEON_BROKER_EXCHANGE_PATH)
    const body = await requestBrokerJson(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    }, 'Neon broker exchange failed')

    return normalizeBrokerExchangeResult(body, 'neon')
  }

  async exchangeFeishuCode(input: ClientAuthBrokerExchangeInput): Promise<ClientAuthBrokerExchangeResult> {
    const endpoint = buildBrokerEndpointUrl(input.brokerUrl, DEFAULT_FEISHU_BROKER_EXCHANGE_PATH)
    const body = await requestBrokerJson(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        code: input.code,
        redirectUri: input.redirectUri,
        codeVerifier: input.codeVerifier,
      }),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    }, 'Feishu broker exchange failed')

    return normalizeBrokerExchangeResult(body, 'feishu')
  }

  async refreshModelAccessToken(
    input: ClientAuthBrokerTokenRefreshInput,
  ): Promise<ClientAuthBrokerTokenRefreshResult> {
    const endpoint = buildBrokerEndpointUrl(input.brokerUrl, DEFAULT_CLIENT_AUTH_TOKEN_PATH)
    const body = await requestBrokerJson(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.appSessionToken}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    }, 'Client auth token refresh failed')

    return {
      appSessionToken: requireStringValue(body.appSessionToken, 'app session token'),
      modelAccessToken: requireStringValue(body.modelAccessToken, 'model access token'),
    }
  }

  async issueSkillsMarketToken(
    input: ClientAuthBrokerTokenRefreshInput,
  ): Promise<ClientAuthBrokerMarketTokenResult> {
    const endpoint = buildBrokerEndpointUrl(input.brokerUrl, DEFAULT_SKILLS_MARKET_TOKEN_PATH)
    const body = await requestBrokerJson(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.appSessionToken}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    }, 'Skills Market token request failed')

    const expiresInSeconds = body.expiresInSeconds
    if (typeof expiresInSeconds !== 'number' || !Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
      throw new Error('Auth broker response did not include a valid Skills Market token lifetime')
    }
    return {
      marketPublishToken: requireStringValue(body.marketPublishToken, 'Skills Market publish token'),
      expiresInSeconds,
    }
  }
}

export async function resolveFeishuBrokerAuthConfig(
  fallback: ClientFeishuBrokerAuthConfig,
  brokerClient: ClientAuthBrokerClient,
): Promise<ClientFeishuBrokerAuthConfig> {
  if (!brokerClient.getFeishuAuthConfig) return fallback

  const brokerConfig = await brokerClient.getFeishuAuthConfig({ brokerUrl: fallback.brokerUrl })
  if (!brokerConfig) return fallback
  if (!brokerConfig.enabled) {
    throw new Error('Feishu login is not configured on the auth broker')
  }

  const appId = readStringValue(brokerConfig.appId)
  if (!appId) {
    throw new Error('Feishu auth broker config did not include an app id')
  }

  const scope = readStringValue(brokerConfig.scope)
  const authBaseUrl = readStringValue(brokerConfig.authBaseUrl)
  return {
    appId,
    brokerUrl: fallback.brokerUrl,
    ...(scope ? { scope } : {}),
    ...(authBaseUrl ? { authBaseUrl } : {}),
  }
}

export function requireAppSessionToken(result: { appSessionToken?: string }): string {
  const token = readStringValue(result.appSessionToken)
  if (!token) throw new Error('Auth broker response did not include an app session token')
  return token
}

export function requireModelAccessToken(result: { modelAccessToken?: string }): string {
  const token = readStringValue(result.modelAccessToken)
  if (!token) throw new Error('Auth broker response did not include a model access token')
  return token
}

export function normalizeBrokerClientAuthUser(
  value: unknown,
  defaultProvider: ClientAuthUser['provider'] = 'feishu',
): ClientAuthUser {
  const record = readObjectValue(value)
  if (!record) throw new Error('Auth broker exchange response did not include a user')

  const provider = record.provider === 'neon' || record.provider === 'feishu'
    ? record.provider
    : defaultProvider
  const userId = readStringValue(record.userId)
    ?? readStringValue(record.openId)
    ?? readStringValue(record.id)
  if (!userId) throw new Error('Auth broker exchange response did not include a user id')

  const email = readStringValue(record.email)
  const name = readStringValue(record.name)
  const avatarUrl = readStringValue(record.avatarUrl)
  const emailVerified = typeof record.emailVerified === 'boolean' ? record.emailVerified : undefined
  return {
    provider,
    userId,
    ...(email ? { email: email.toLowerCase() } : {}),
    ...(emailVerified !== undefined ? { emailVerified } : {}),
    ...(name ? { name } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  }
}

export function isRejectedAppSession(error: unknown): boolean {
  return error instanceof ClientAuthBrokerHttpError
    && (error.status === 401 || error.status === 403)
}

function normalizeFeishuBrokerPublicConfig(body: Record<string, unknown>): ClientFeishuBrokerPublicConfig {
  const appId = readStringValue(body.appId)
  const scope = readStringValue(body.scope)
  const authBaseUrl = readStringValue(body.authBaseUrl)
  return {
    enabled: body.enabled === true,
    ...(appId ? { appId } : {}),
    ...(scope ? { scope } : {}),
    ...(authBaseUrl ? { authBaseUrl } : {}),
  }
}

function normalizeBrokerExchangeResult(
  body: Record<string, unknown>,
  defaultProvider: ClientAuthUser['provider'],
): ClientAuthBrokerExchangeResult {
  const user = normalizeBrokerClientAuthUser(readObjectValue(body.user), defaultProvider)
  const appSessionToken = readStringValue(body.appSessionToken)
  const modelAccessToken = readStringValue(body.modelAccessToken)
  return {
    user,
    ...(appSessionToken ? { appSessionToken } : {}),
    ...(modelAccessToken ? { modelAccessToken } : {}),
  }
}

function requireStringValue(value: unknown, label: string): string {
  const normalized = readStringValue(value)
  if (!normalized) throw new Error(`Auth broker response did not include a valid ${label}`)
  return normalized
}

function buildBrokerEndpointUrl(baseUrl: string, path: string): string {
  const secureBaseUrl = normalizeClientAuthBrokerUrl(baseUrl)
  const normalizedBase = secureBaseUrl.endsWith('/') ? secureBaseUrl : `${secureBaseUrl}/`
  return new URL(path.replace(/^\/+/, ''), normalizedBase).toString()
}

function formatBrokerNetworkError(endpoint: string, error: unknown): string {
  const detail = error instanceof Error && error.message ? ` (${error.message})` : ''
  return `Auth broker is unreachable at ${endpoint}${detail}. `
    + '若网络受限或 broker 已迁移，可在客户端用户数据目录创建 client-auth.json '
    + '（内容形如 {"authBrokerUrl":"https://your-broker"}）以覆盖打包默认值；'
    + 'or set CRAFT_CLIENT_AUTH_BROKER_URL and rebuild the desktop client.'
}

function requestBrokerJson(
  endpoint: string,
  init: RequestInit,
  failurePrefix: string,
  options: { allowNotFound: true },
): Promise<Record<string, unknown> | null>
function requestBrokerJson(
  endpoint: string,
  init: RequestInit,
  failurePrefix: string,
  options?: { allowNotFound?: false },
): Promise<Record<string, unknown>>
async function requestBrokerJson(
  endpoint: string,
  init: RequestInit,
  failurePrefix: string,
  options: { allowNotFound?: boolean } = {},
): Promise<Record<string, unknown> | null> {
  let res: Response
  try {
    res = await fetch(endpoint, init)
  } catch (error) {
    throw new Error(formatBrokerNetworkError(endpoint, error))
  }

  if (options.allowNotFound && res.status === 404) return null

  const body = await parseJsonObject(res)
  if (!res.ok) {
    throw new ClientAuthBrokerHttpError(
      readBrokerError(body) ?? `${failurePrefix}: HTTP ${res.status}`,
      res.status,
    )
  }
  return body
}

async function parseJsonObject(res: Response): Promise<Record<string, unknown>> {
  try {
    const body = await res.json()
    return readObjectValue(body) ?? {}
  } catch {
    return {}
  }
}

function readBrokerError(body: Record<string, unknown>): string | undefined {
  const error = readObjectValue(body.error)
  return readStringValue(error?.message)
    ?? readStringValue(body.message)
    ?? readStringValue(body.error)
}

function readObjectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function readStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
