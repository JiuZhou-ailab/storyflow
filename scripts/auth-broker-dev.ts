// input: Desktop client auth env vars and local auth broker port settings
// output: Development auth broker for Electron email/Feishu login
// pos: Local-only bootstrap script used by electron-dev when desktop auth needs a broker

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createPostgresFeishuRegistrationStore,
  startWebuiHttpServer,
  type FeishuAuthConfig,
  type NeonAuthConfig,
} from '@craft-agent/server-core/webui'

const ROOT_DIR = join(import.meta.dir, '..')
const DEFAULT_PORT = 9100

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value || undefined
}

function readFirstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = readEnv(name)
    if (value) return value
  }
  return undefined
}

function parseBoolean(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return undefined
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  throw new Error(`Invalid boolean env value: ${value}`)
}

function parseCsv(value: string | undefined): string[] {
  return value?.split(',')
    .map((part) => part.trim())
    .filter(Boolean) ?? []
}

function resolvePort(): number {
  const brokerUrl = readFirstEnv('CRAFT_CLIENT_AUTH_BROKER_URL', 'CRAFT_CLIENT_FEISHU_AUTH_BROKER_URL')
  if (!brokerUrl) return DEFAULT_PORT

  const url = new URL(brokerUrl)
  if (url.port) return Number(url.port)
  return url.protocol === 'https:' ? 443 : 80
}

async function isHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`)
    return res.ok
  } catch {
    return false
  }
}

function createMinimalWebuiDir(): string {
  const dir = join(ROOT_DIR, '.tmp', 'auth-broker-webui')
  mkdirSync(dir, { recursive: true })

  const loginPath = join(dir, 'login.html')
  if (!existsSync(loginPath)) {
    writeFileSync(loginPath, '<!doctype html><html><body>Auth broker</body></html>', 'utf-8')
  }

  const indexPath = join(dir, 'index.html')
  if (!existsSync(indexPath)) {
    writeFileSync(indexPath, '<!doctype html><html><body>Auth broker</body></html>', 'utf-8')
  }

  return dir
}

function createNeonAuthConfig(): NeonAuthConfig | undefined {
  const baseUrl = readFirstEnv('CRAFT_CLIENT_NEON_AUTH_BASE_URL', 'CRAFT_WEBUI_NEON_AUTH_BASE_URL')
  if (!baseUrl) return undefined

  const jwksUrl = readFirstEnv('CRAFT_CLIENT_NEON_AUTH_JWKS_URL', 'CRAFT_WEBUI_NEON_AUTH_JWKS_URL')
  const issuer = readFirstEnv('CRAFT_CLIENT_NEON_AUTH_ISSUER', 'CRAFT_WEBUI_NEON_AUTH_ISSUER')
  const audience = readFirstEnv('CRAFT_CLIENT_NEON_AUTH_AUDIENCE', 'CRAFT_WEBUI_NEON_AUTH_AUDIENCE')
  const usernameEmailDomain = readFirstEnv(
    'CRAFT_CLIENT_NEON_AUTH_USERNAME_EMAIL_DOMAIN',
    'CRAFT_WEBUI_NEON_AUTH_USERNAME_EMAIL_DOMAIN',
  )

  return {
    baseUrl,
    ...(jwksUrl ? { jwksUrl } : {}),
    ...(issuer ? { issuer } : {}),
    ...(audience ? { audience } : {}),
    ...(usernameEmailDomain ? { usernameEmailDomain } : {}),
  }
}

const appId = readFirstEnv('CRAFT_WEBUI_FEISHU_APP_ID', 'CRAFT_CLIENT_FEISHU_APP_ID')
const appSecret = readEnv('CRAFT_WEBUI_FEISHU_APP_SECRET')
const neonAuth = createNeonAuthConfig()
const feishuAuth: FeishuAuthConfig | undefined = appId && appSecret
  ? {
      appId,
      appSecret,
      redirectUri: readEnv('CRAFT_WEBUI_FEISHU_REDIRECT_URI'),
      scope: readEnv('CRAFT_WEBUI_FEISHU_SCOPE'),
      internalTenantKeys: parseCsv(readEnv('CRAFT_WEBUI_FEISHU_INTERNAL_TENANT_KEYS')),
      allowAllUsers: parseBoolean(readEnv('CRAFT_WEBUI_FEISHU_ALLOW_ALL_USERS')) ?? false,
      registrationStore: createPostgresFeishuRegistrationStore(readEnv('CRAFT_WEBUI_AUTH_DATABASE_URL')),
    }
  : undefined

if (!feishuAuth && !neonAuth) {
  console.error('[auth-broker-dev] Missing auth provider config. Set CRAFT_WEBUI_NEON_AUTH_BASE_URL for email login or CRAFT_WEBUI_FEISHU_APP_ID/CRAFT_WEBUI_FEISHU_APP_SECRET for Feishu login.')
  process.exit(1)
}

const clientAppId = readEnv('CRAFT_CLIENT_FEISHU_APP_ID')
if (clientAppId && appId && clientAppId !== appId) {
  console.warn(`[auth-broker-dev] CRAFT_CLIENT_FEISHU_APP_ID (${clientAppId}) differs from CRAFT_WEBUI_FEISHU_APP_ID (${appId}). Feishu token exchange will fail unless they match.`)
}

const port = resolvePort()

if (await isHealthy(port)) {
  console.log(`[auth-broker-dev] Existing auth broker is healthy at http://127.0.0.1:${port}`)
  process.exit(0)
}

const secret = readEnv('CRAFT_SERVER_TOKEN') ?? randomBytes(24).toString('hex')

const server = await startWebuiHttpServer({
  port,
  webuiDir: createMinimalWebuiDir(),
  secret,
  passwordAuthEnabled: false,
  secureCookies: false,
  wsProtocol: 'ws',
  wsPort: port,
  getHealthCheck: () => ({ status: 'ok' }),
  feishuAuth,
  neonAuth,
  logger: console as any,
})

console.log(`[auth-broker-dev] Listening on http://127.0.0.1:${server.port}`)
if (neonAuth) {
  console.log('[auth-broker-dev] Neon exchange endpoint: /api/client-auth/neon/exchange')
}
if (feishuAuth) {
  console.log('[auth-broker-dev] Feishu exchange endpoint: /api/client-auth/feishu/exchange')
}

const shutdown = () => {
  server.stop()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await new Promise(() => {})
