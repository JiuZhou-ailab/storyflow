// input: Web UI HTTP requests, auth options, static web UI files
// output: Web-standard Web UI fetch handler and standalone Bun server
// pos: Server-core HTTP/auth boundary for browser and desktop client sessions

/**
 * Web UI HTTP handler and standalone server.
 *
 * The core logic lives in `createWebuiHandler()` which returns a web-standard
 * fetch handler `(Request) => Promise<Response>`. This handler can be:
 *
 * 1. **Embedded** — attached to the WsRpcServer's HTTPS server via the
 *    node-adapter so that HTTP and WSS share a single port.
 * 2. **Standalone** — wrapped in `Bun.serve()` via `startWebuiHttpServer()`
 *    for separate-port deployments or development.
 */

import { join, extname } from 'node:path'
import {
  RateLimiter,
  initPasswordHash,
  verifyPassword,
  createSessionToken,
  validateSession,
  buildSessionCookie,
  buildLogoutCookie,
} from './auth'
import { generateCallbackPage } from '@craft-agent/shared/auth'
import type { PlatformServices } from '../runtime/platform'
import { FeishuLoginService, type FeishuAuthConfig } from './feishu-auth'
import { NeonAuthService, type NeonAuthConfig, type NeonAuthIdentity } from './neon-auth'

// ---------------------------------------------------------------------------
// MIME types for static file serving
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.map': 'application/json',
}

function getMimeType(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

function getForwardedValue(req: Request, key: 'proto' | 'host'): string | null {
  const forwarded = req.headers.get('forwarded')
  if (!forwarded) return null

  const match = forwarded.match(new RegExp(`${key}="?([^;,"]+)"?`, 'i'))
  return match?.[1]?.trim() || null
}

function getRequestProto(req: Request): string {
  return req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    || getForwardedValue(req, 'proto')
    || new URL(req.url).protocol.replace(/:$/, '')
}

function getRequestHost(req: Request): string | null {
  return req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    || getForwardedValue(req, 'host')
    || req.headers.get('host')
}

function formatHostWithPort(host: string, port: number): string {
  try {
    const parsed = new URL(`http://${host}`)
    const hostname = parsed.hostname.includes(':') ? `[${parsed.hostname}]` : parsed.hostname
    return `${hostname}:${port}`
  } catch {
    const withoutPort = host.replace(/:\d+$/, '')
    return `${withoutPort}:${port}`
  }
}

export function shouldUseSecureCookies(req: Request, secureCookies?: boolean): boolean {
  if (secureCookies != null) return secureCookies
  return getRequestProto(req) === 'https'
}

export interface ResolveWebSocketUrlOptions {
  publicWsUrl?: string
  wsProtocol: 'ws' | 'wss'
  wsPort: number
}

export function resolveWebSocketUrl(
  req: Request,
  { publicWsUrl, wsProtocol, wsPort }: ResolveWebSocketUrlOptions,
): string {
  if (publicWsUrl) return publicWsUrl

  const host = getRequestHost(req)
  if (host) {
    return `${wsProtocol}://${formatHostWithPort(host, wsPort)}`
  }

  return `${wsProtocol}://127.0.0.1:${wsPort}`
}

function resolveRequestOrigin(req: Request): string {
  const host = getRequestHost(req)
  if (host) {
    return `${getRequestProto(req)}://${host}`
  }

  return new URL(req.url).origin
}

// ---------------------------------------------------------------------------
// Handler options (shared between embedded and standalone modes)
// ---------------------------------------------------------------------------

/** Dependencies for the /api/oauth/callback HTTP route (server-side OAuth completion). */
export interface OAuthCallbackDeps {
  flowStore: { getByState: (state: string) => any; remove: (state: string) => void }
  credManager: { exchangeAndStore: (...args: any[]) => Promise<any> }
  sessionManager: { completeAuthRequest: (...args: any[]) => Promise<void> }
  pushSourcesChanged: (workspaceId: string) => void
}

export interface WebuiHandlerOptions {
  /** Path to built web UI dist/ directory. */
  webuiDir: string
  /** Secret used to sign JWTs — typically CRAFT_SERVER_TOKEN. */
  secret: string
  /** Optional separate web UI password. Falls back to `secret` for verification. */
  password?: string
  /** Explicit Secure-cookie override. When unset, infer from the request / proxy headers. */
  secureCookies?: boolean
  /** Optional browser-facing WebSocket URL override for reverse-proxy deployments. */
  publicWsUrl?: string
  /** RPC WebSocket protocol used when building a browser-facing fallback URL. */
  wsProtocol: 'ws' | 'wss'
  /** RPC WebSocket port used when building a browser-facing fallback URL. */
  wsPort: number
  /** Health check function (injected from existing server handler). */
  getHealthCheck: () => { status: string }
  /** Logger. */
  logger: PlatformServices['logger']
  /** OAuth callback deps — when provided, enables /api/oauth/callback route. */
  oauthCallbackDeps?: OAuthCallbackDeps
  /** Feishu OAuth login configuration for Web UI browser sessions. */
  feishuAuth?: FeishuAuthConfig
  /** Neon Auth configuration for email sign-in/sign-up browser sessions. */
  neonAuth?: NeonAuthConfig
  /** Deprecated. Model access is seeded locally through CRAFT_CLIENT_GATEWAY_TOKEN. */
  clientGatewayToken?: string
  /** Deprecated. The desktop auth broker no longer issues model gateway JWTs. */
  clientGatewayJwtSecret?: string
  /** Deprecated. The desktop auth broker no longer issues model gateway JWTs. */
  clientGatewayTokenTtlSeconds?: number
  /** Deprecated. The desktop auth broker no longer issues model gateway JWTs. */
  clientGatewayTokenAudience?: string
  /** Deprecated. The desktop auth broker no longer issues model gateway JWTs. */
  clientGatewayTokenIssuer?: string
  /** Deprecated. Model connection selection is local to the desktop app. */
  clientGatewayConnectionSlugs?: string[]
  /** Enables the legacy server-token login form and /api/auth endpoint. Defaults to true. */
  passwordAuthEnabled?: boolean
  /**
   * Trusted proxy IPs/CIDRs. When set, proxy headers (x-forwarded-for, x-forwarded-proto)
   * are only trusted from these sources. When empty/unset, proxy headers are ignored
   * and 'direct' is used as the rate-limit key.
   */
  trustedProxies?: string[]
}

// ---------------------------------------------------------------------------
// Handler factory — the core request handler
// ---------------------------------------------------------------------------

export interface WebuiHandler {
  /** Web-standard fetch handler. */
  fetch: (req: Request) => Promise<Response>
  /** Call on shutdown to release timers. */
  dispose: () => void
  /** Inject OAuth callback deps after bootstrap (lazy wiring). */
  setOAuthCallbackDeps: (deps: OAuthCallbackDeps) => void
}

/**
 * Create a web-standard fetch handler for the WebUI.
 *
 * This handler can be used directly with `Bun.serve({ fetch })`,
 * or adapted for Node's HTTP server via `nodeHttpAdapter()`.
 */
export function createWebuiHandler(options: WebuiHandlerOptions): WebuiHandler {
  const {
    webuiDir,
    secret,
    password,
    secureCookies,
    publicWsUrl,
    wsProtocol,
    wsPort,
    getHealthCheck,
    logger,
    trustedProxies,
  } = options

  const rateLimiter = new RateLimiter(5, 60_000)
  const cleanupTimer = setInterval(() => rateLimiter.cleanup(), 120_000)
  const feishuLogin = options.feishuAuth ? new FeishuLoginService(options.feishuAuth) : null
  const neonAuth = options.neonAuth ? new NeonAuthService(options.neonAuth) : null
  const passwordAuthEnabled = options.passwordAuthEnabled ?? true

  const loginPassword = password || secret
  const trustedProxySet = new Set(trustedProxies ?? [])

  // Hash the login password at startup (async, but resolves before first auth attempt in practice)
  const passwordReady = initPasswordHash(loginPassword)

  /** Extract client IP — only trusts proxy headers when trustedProxies is configured. */
  function getClientIp(req: Request): string {
    if (trustedProxySet.size > 0) {
      return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        ?? req.headers.get('x-real-ip')
        ?? 'direct'
    }
    return 'direct'
  }

  async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    const useSecureCookies = shouldUseSecureCookies(req, secureCookies)

    // ── Health endpoint (no auth) ──
    if (path === '/health') {
      const health = getHealthCheck()
      return Response.json(health, {
        status: health.status === 'ok' ? 200 : 503,
      })
    }

    // ── Login page (no auth) ──
    if (path === '/login' || path === '/login/') {
      const loginFile = Bun.file(join(webuiDir, 'login.html'))
      if (await loginFile.exists()) {
        return new Response(loginFile, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      return new Response('Login page not found', { status: 404 })
    }

    // ── Static assets that login page needs (no auth) ──
    if (path === '/favicon.ico' || path.startsWith('/login-assets/')) {
      const file = Bun.file(join(webuiDir, path))
      if (await file.exists()) {
        return new Response(file, {
          headers: { 'Content-Type': getMimeType(path) },
        })
      }
      return new Response('Not Found', { status: 404 })
    }

    // ── Auth endpoint ──
    if (path === '/api/auth' && req.method === 'POST') {
      if (!passwordAuthEnabled) {
        return Response.json({ error: 'Password login is disabled' }, { status: 403 })
      }

      await passwordReady
      const ip = getClientIp(req)

      if (!rateLimiter.check(ip)) {
        logger.warn(`[webui] Rate limited auth attempt from ${ip}`)
        return Response.json(
          { error: 'Too many attempts. Try again later.' },
          { status: 429 },
        )
      }

      let body: { password?: string }
      try {
        body = await req.json() as { password?: string }
      } catch {
        return Response.json({ error: 'Invalid request body' }, { status: 400 })
      }

      if (!body.password || typeof body.password !== 'string') {
        return Response.json({ error: 'Password is required' }, { status: 400 })
      }

      if (!await verifyPassword(body.password)) {
        logger.warn(`[webui] Failed auth attempt from ${ip}`)
        return Response.json({ error: 'Invalid credentials' }, { status: 401 })
      }

      const jwt = await createSessionToken(secret)
      logger.info(`[webui] Successful auth from ${ip}`)

      return Response.json({ ok: true }, {
        status: 200,
        headers: {
          'Set-Cookie': buildSessionCookie(jwt, useSecureCookies),
        },
      })
    }

    // ── Logout endpoint ──
    if (path === '/api/auth/logout' && req.method === 'POST') {
      return new Response(null, {
        status: 204,
        headers: {
          'Set-Cookie': buildLogoutCookie(useSecureCookies),
        },
      })
    }

    // ── Neon Auth email login endpoints (no cookie auth; JWT is verified server-side) ──
    if (path === '/api/auth/neon/config' && req.method === 'GET') {
      const neonClientConfig = neonAuth?.getClientConfig() ?? { enabled: false }
      return Response.json({
        ...neonClientConfig,
        ...(!passwordAuthEnabled ? { passwordAuthEnabled: false } : {}),
      })
    }

    if (path === '/api/auth/neon/exchange' && req.method === 'POST') {
      const exchange = await verifyNeonExchangeIdentity(req, 'Neon Auth exchange')
      if (exchange instanceof Response) return exchange

      const { identity } = exchange
      const jwt = await createSessionToken(secret, identity.subject)
      logger.info(`[webui] Successful Neon Auth for ${formatNeonIdentity(identity)}`)

      return Response.json({
        ok: true,
        user: toPublicNeonIdentity(identity),
      }, {
        status: 200,
        headers: {
          'Set-Cookie': buildSessionCookie(jwt, useSecureCookies),
        },
      })
    }

    if (path === '/api/auth/neon/email' && req.method === 'POST') {
      if (!neonAuth?.isConfigured()) {
        return Response.json({ error: 'Neon Auth is not configured' }, { status: 404 })
      }

      const ip = getClientIp(req)
      if (!rateLimiter.check(ip)) {
        logger.warn(`[webui] Rate limited Neon Auth email request from ${ip}`)
        return Response.json(
          { error: 'Too many attempts. Try again later.' },
          { status: 429 },
        )
      }

      const emailRequest = await readNeonEmailPasswordRequest(req)
      if ('error' in emailRequest) {
        return Response.json({ error: emailRequest.error }, { status: 400 })
      }

      try {
        const requestOrigin = resolveRequestOrigin(req)
        const result = await neonAuth.authenticateWithEmailPassword({
          ...emailRequest,
          origin: requestOrigin,
          callbackURL: `${requestOrigin}/login`,
        })

        if (result.status === 'verification-required') {
          return Response.json({
            ok: false,
            status: 'verification-required',
            ...(result.user ? { user: result.user } : {}),
          }, { status: 202 })
        }

        const identity = await neonAuth.verifyToken(result.token)
        const jwt = await createSessionToken(secret, identity.subject)
        logger.info(`[webui] Successful Neon Auth email ${emailRequest.mode} for ${formatNeonIdentity(identity)}`)

        return Response.json({
          ok: true,
          user: toPublicNeonIdentity(identity),
        }, {
          status: 200,
          headers: {
            'Set-Cookie': buildSessionCookie(jwt, useSecureCookies),
          },
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Neon Auth email login failed'
        logger.warn(`[webui] Neon Auth email request rejected from ${ip}: ${msg}`)
        return Response.json({ error: msg }, { status: 401 })
      }
    }

    if (path === '/api/client-auth/neon/exchange' && req.method === 'POST') {
      const exchange = await verifyNeonExchangeIdentity(req, 'Neon client auth broker exchange')
      if (exchange instanceof Response) return exchange

      const { identity } = exchange
      const appSessionToken = await createSessionToken(secret, identity.subject)
      logger.info(`[webui] Successful Neon client auth broker exchange for ${formatNeonIdentity(identity)}`)

      return Response.json({
        ok: true,
        user: toPublicNeonIdentity(identity),
        appSessionToken,
      })
    }

    // ── OAuth callback (no cookie auth — state param is CSRF protection) ──
    // Receives redirect from the relay (or directly from OAuth provider for MCP sources).
    // Completes the token exchange server-side and renders a success/error page.
    if (path === '/api/oauth/callback' && req.method === 'GET' && options.oauthCallbackDeps) {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const error = url.searchParams.get('error')
      const errorDescription = url.searchParams.get('error_description')

      if (error) {
        const flow = state ? options.oauthCallbackDeps.flowStore.getByState(state) : null
        if (flow && state) options.oauthCallbackDeps.flowStore.remove(state)
        const errorMsg = errorDescription || error
        logger.warn(`[webui] OAuth callback error: ${errorMsg}`)
        return new Response(generateCallbackPage({ title: 'Authorization Failed', isSuccess: false, errorDetail: errorMsg }), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }

      if (!code || !state) {
        return new Response(generateCallbackPage({ title: 'Authorization Failed', isSuccess: false, errorDetail: 'Missing code or state parameter' }), {
          status: 400,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }

      try {
        const { completeOAuthFlow } = await import('../handlers/rpc/oauth')
        const result = await completeOAuthFlow({
          code,
          state,
          flowStore: options.oauthCallbackDeps.flowStore,
          credManager: options.oauthCallbackDeps.credManager as any,
          sessionManager: options.oauthCallbackDeps.sessionManager,
          pushSourcesChanged: options.oauthCallbackDeps.pushSourcesChanged,
          logger,
          // No clientId/workspaceId — HTTP callback skips ownership checks (state is auth)
        })

        if (result.success) {
          return new Response(generateCallbackPage({ title: 'Authorization Successful', isSuccess: true }), {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        } else {
          return new Response(generateCallbackPage({ title: 'Authorization Failed', isSuccess: false, errorDetail: result.error }), {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Token exchange failed'
        logger.error(`[webui] OAuth callback failed: ${msg}`)
        return new Response(generateCallbackPage({ title: 'Authorization Failed', isSuccess: false, errorDetail: msg }), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
    }

    // ── Feishu login endpoints (no auth; OAuth state is CSRF protection) ──
    if (path === '/api/auth/feishu/config' && req.method === 'GET') {
      return Response.json(feishuLogin?.getClientAuthConfig() ?? { enabled: false })
    }

    if (path === '/api/client-auth/feishu/config' && req.method === 'GET') {
      return Response.json(feishuLogin?.getClientAuthConfig() ?? { enabled: false })
    }

    if (path === '/api/auth/feishu/start' && req.method === 'GET') {
      if (!feishuLogin?.isConfigured()) {
        return Response.json({ error: 'Feishu login is not configured' }, { status: 404 })
      }

      const redirectUri = `${resolveRequestOrigin(req)}/api/auth/feishu/callback`
      const { authUrl } = feishuLogin.startLogin(redirectUri)
      return new Response(null, {
        status: 302,
        headers: { Location: authUrl },
      })
    }

    if (path === '/api/auth/feishu/callback' && req.method === 'GET') {
      if (!feishuLogin?.isConfigured()) {
        return Response.json({ error: 'Feishu login is not configured' }, { status: 404 })
      }

      const error = url.searchParams.get('error')
      const errorDescription = url.searchParams.get('error_description')
      if (error) {
        return new Response(errorDescription || error, {
          status: 400,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }

      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      if (!code || !state) {
        return new Response('Missing code or state parameter', {
          status: 400,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }

      try {
        const decision = await feishuLogin.completeLogin({ code, state })
        if (!decision.allowed) {
          logger.warn(`[webui] Feishu registration required for ${formatFeishuIdentity(decision.user)}`)
          return new Response('Registration required', {
            status: 403,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        }

        const jwt = await createSessionToken(secret, `feishu:${decision.user.openId}`)
        logger.info(`[webui] Successful Feishu auth (${decision.reason}) for ${formatFeishuIdentity(decision.user)}`)
        return new Response(null, {
          status: 302,
          headers: {
            Location: '/',
            'Set-Cookie': buildSessionCookie(jwt, useSecureCookies),
          },
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Feishu login failed'
        logger.error(`[webui] Feishu login failed: ${msg}`)
        return new Response(msg, {
          status: 400,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }
    }

    if (path === '/api/client-auth/feishu/exchange' && req.method === 'POST') {
      if (!feishuLogin?.isConfigured()) {
        return Response.json({ error: 'Feishu login is not configured' }, { status: 404 })
      }

      const ip = getClientIp(req)
      if (!rateLimiter.check(ip)) {
        logger.warn(`[webui] Rate limited Feishu client auth broker exchange from ${ip}`)
        return Response.json(
          { error: 'Too many attempts. Try again later.' },
          { status: 429 },
        )
      }

      const exchangeRequest = await readFeishuBrokerExchangeRequest(req)
      if ('error' in exchangeRequest) {
        return Response.json({ error: exchangeRequest.error }, { status: 400 })
      }

      try {
        const decision = await feishuLogin.exchangeCodeForDecision(exchangeRequest)
        if (!decision.allowed) {
          logger.warn(`[webui] Feishu client auth broker registration required for ${formatFeishuIdentity(decision.user)}`)
          return Response.json({ error: 'Registration required' }, { status: 403 })
        }

        const appSessionToken = await createSessionToken(secret, `feishu:${decision.user.openId}`)
        logger.info(`[webui] Successful Feishu client auth broker exchange (${decision.reason}) for ${formatFeishuIdentity(decision.user)}`)
        return Response.json({
          ok: true,
          user: toPublicFeishuIdentity(decision.user),
          appSessionToken,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Feishu client auth broker exchange failed'
        logger.warn(`[webui] Feishu client auth broker exchange rejected from ${ip}: ${msg}`)
        return Response.json({ error: msg }, { status: 401 })
      }
    }

    // ── Config endpoint (requires session cookie) ──
    if (path === '/api/config' && req.method === 'GET') {
      const configSession = await validateSession(req.headers.get('cookie'), secret)
      if (!configSession) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return Response.json({
        wsUrl: resolveWebSocketUrl(req, { publicWsUrl, wsProtocol, wsPort }),
      })
    }

    // Return the default workspace ID so the webui can include it in the WS handshake
    if (path === '/api/config/workspaces' && req.method === 'GET') {
      const configSession = await validateSession(req.headers.get('cookie'), secret)
      if (!configSession) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const { getActiveWorkspace } = await import('@craft-agent/shared/config/storage')
      const active = getActiveWorkspace()
      return Response.json({
        defaultWorkspaceId: active?.id ?? null,
      })
    }

    // ── Everything below requires a valid session cookie ──
    const cookieHeader = req.headers.get('cookie')
    const session = await validateSession(cookieHeader, secret)

    if (!session) {
      const accept = req.headers.get('accept') ?? ''
      if (accept.includes('text/html') || path === '/' || path === '') {
        return Response.redirect('/login', 302)
      }
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ── Serve SPA static files ──
    if (path !== '/') {
      const file = Bun.file(join(webuiDir, path))
      if (await file.exists()) {
        return new Response(file, {
          headers: { 'Content-Type': getMimeType(path) },
        })
      }
    }

    // SPA fallback — serve index.html for all non-file routes
    const indexFile = Bun.file(join(webuiDir, 'index.html'))
    if (await indexFile.exists()) {
      return new Response(indexFile, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    return new Response('Not Found', { status: 404 })
  }

  async function verifyNeonExchangeIdentity(
    req: Request,
    label: string,
  ): Promise<{ identity: NeonAuthIdentity } | Response> {
    if (!neonAuth?.isConfigured()) {
      return Response.json({ error: 'Neon Auth is not configured' }, { status: 404 })
    }

    const ip = getClientIp(req)
    if (!rateLimiter.check(ip)) {
      logger.warn(`[webui] Rate limited ${label} from ${ip}`)
      return Response.json(
        { error: 'Too many attempts. Try again later.' },
        { status: 429 },
      )
    }

    const token = await readNeonExchangeToken(req)
    if (!token) {
      return Response.json({ error: 'Neon Auth token is required' }, { status: 400 })
    }

    try {
      return { identity: await neonAuth.verifyToken(token) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid Neon Auth token'
      logger.warn(`[webui] ${label} rejected from ${ip}: ${msg}`)
      return Response.json({ error: msg }, { status: 401 })
    }
  }

  return {
    fetch,
    dispose: () => clearInterval(cleanupTimer),
    setOAuthCallbackDeps: (deps: OAuthCallbackDeps) => {
      options.oauthCallbackDeps = deps
    },
  }
}

function formatFeishuIdentity(user: { openId: string, email?: string, tenantKey?: string }): string {
  const parts = [`open_id=${user.openId}`]
  if (user.email) parts.push(`email=${user.email}`)
  if (user.tenantKey) parts.push(`tenant_key=${user.tenantKey}`)
  return parts.join(' ')
}

async function readNeonExchangeToken(req: Request): Promise<string | null> {
  const bearerToken = readBearerToken(req.headers.get('authorization'))
  if (bearerToken) return bearerToken

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return null
  }

  if (!body || typeof body !== 'object') return null
  const token = (body as { token?: unknown }).token
  return typeof token === 'string' && token.trim() ? token.trim() : null
}

async function readNeonEmailPasswordRequest(req: Request): Promise<
  | { mode: 'sign-in' | 'sign-up', email: string, password: string, name?: string }
  | { error: string }
> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return { error: 'Invalid request body' }
  }

  if (!body || typeof body !== 'object') {
    return { error: 'Invalid request body' }
  }

  const raw = body as Record<string, unknown>
  const mode = raw.mode === 'sign-up' ? 'sign-up' : raw.mode === 'sign-in' ? 'sign-in' : null
  if (!mode) return { error: 'Mode must be sign-in or sign-up' }

  const email = typeof raw.email === 'string' ? raw.email.trim() : ''
  if (!email) return { error: 'Email or username is required' }

  const password = typeof raw.password === 'string' ? raw.password : ''
  if (!password) return { error: 'Password is required' }

  const name = typeof raw.name === 'string' && raw.name.trim()
    ? raw.name.trim()
    : undefined

  return {
    mode,
    email,
    password,
    ...(name ? { name } : {}),
  }
}

async function readFeishuBrokerExchangeRequest(req: Request): Promise<
  | { code: string, redirectUri: string, codeVerifier: string }
  | { error: string }
> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return { error: 'Invalid request body' }
  }

  if (!body || typeof body !== 'object') {
    return { error: 'Invalid request body' }
  }

  const raw = body as Record<string, unknown>
  const code = typeof raw.code === 'string' ? raw.code.trim() : ''
  if (!code) return { error: 'Feishu OAuth code is required' }

  const redirectUri = typeof raw.redirectUri === 'string' ? raw.redirectUri.trim() : ''
  if (!redirectUri) return { error: 'Feishu redirect URI is required' }
  if (!isLoopbackFeishuRedirectUri(redirectUri)) {
    return { error: 'Feishu redirect URI must be a loopback callback URL' }
  }

  const codeVerifier = typeof raw.codeVerifier === 'string' ? raw.codeVerifier.trim() : ''
  if (!codeVerifier) return { error: 'Feishu PKCE code verifier is required' }

  return { code, redirectUri, codeVerifier }
}

function isLoopbackFeishuRedirectUri(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && url.pathname === '/callback'
  } catch {
    return false
  }
}

function readBearerToken(header: string | null): string | null {
  if (!header) return null
  const [scheme, ...rest] = header.trim().split(/\s+/)
  if (scheme?.toLowerCase() !== 'bearer') return null
  const token = rest.join(' ').trim()
  return token || null
}

function toPublicNeonIdentity(identity: NeonAuthIdentity): Record<string, unknown> {
  return {
    provider: identity.provider,
    userId: identity.userId,
    ...(identity.email ? { email: identity.email } : {}),
    ...(identity.emailVerified !== undefined ? { emailVerified: identity.emailVerified } : {}),
    ...(identity.name ? { name: identity.name } : {}),
  }
}

function toPublicFeishuIdentity(user: { openId: string, email?: string, enterpriseEmail?: string, name?: string }): Record<string, unknown> {
  const email = (user.enterpriseEmail ?? user.email)?.toLowerCase()
  return {
    provider: 'feishu',
    userId: user.openId,
    ...(email ? { email } : {}),
    ...(user.name ? { name: user.name } : {}),
  }
}

function formatNeonIdentity(identity: NeonAuthIdentity): string {
  const parts = [`user_id=${identity.userId}`]
  if (identity.email) parts.push(`email=${identity.email}`)
  return parts.join(' ')
}

// ---------------------------------------------------------------------------
// Standalone server (backwards-compatible, uses Bun.serve)
// ---------------------------------------------------------------------------

export interface WebuiHttpServerOptions extends WebuiHandlerOptions {
  /** Port to bind on. Use 0 for an ephemeral port in tests. */
  port: number
}

export async function startWebuiHttpServer(
  options: WebuiHttpServerOptions,
): Promise<{ port: number, stop: () => void }> {
  const { port, logger, ...handlerOpts } = options
  const handler = createWebuiHandler({ ...handlerOpts, logger })

  const server = Bun.serve({
    port,
    fetch: handler.fetch,
  })

  const boundPort = server.port ?? port
  logger.info(`[webui] Web UI server listening on http://0.0.0.0:${boundPort}`)

  return {
    port: boundPort,
    stop: () => {
      handler.dispose()
      server.stop()
    },
  }
}
