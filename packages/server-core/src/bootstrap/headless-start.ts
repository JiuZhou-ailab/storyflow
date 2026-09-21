// input: Server transport options, Host Project registrations, and host-provided SessionManager/RPC dependencies
// output: A compatibility-upgraded, transport-ready server with an explicitly startable Agent runtime
// pos: Owns the two-stage server lifecycle shared by Electron and headless hosts

import { mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { acquireServerLock, hasServerLock, releaseServerLock } from './server-lock'
export { acquireServerLock, releaseServerLock, ServerLockError } from './server-lock'
import { OAuthFlowStore } from '@craft-agent/shared/auth'
import { seedDefaultAgentResources } from '@craft-agent/shared/agent-defaults'
import { ensureConfigDir, loadStoredConfig, restoreStoredConfigBackup, saveConfig } from '@craft-agent/shared/config'
import { CONFIG_DIR } from '@craft-agent/shared/config/paths'
import { setBundledAssetsRoot } from '@craft-agent/shared/utils'
import { migrateLegacyLocalProjectDirectoryIdentities } from '@craft-agent/shared/workspaces'
import { WsRpcServer, type WsRpcTlsOptions } from '../transport/server'
import type { EventSink, RpcServer } from '../transport/types'
import { createHeadlessPlatform } from '../runtime/platform-headless'
import type { PlatformServices } from '../runtime/platform'

interface ModelRefreshServiceLike {
  startAll(): void
  stopAll?(): void
}

export interface ServerBootstrapOptions<TSessionManager, THandlerDeps> {
  serverToken?: string
  rpcHost?: string
  rpcPort?: number
  bundledAssetsRoot?: string
  platformFactory?: () => PlatformServices
  applyPlatformToSubsystems?: (platform: PlatformServices) => void
  createSessionManager: () => TSessionManager
  createHandlerDeps: (ctx: {
    sessionManager: TSessionManager
    platform: PlatformServices
    oauthFlowStore: OAuthFlowStore
  }) => THandlerDeps
  registerAllRpcHandlers: (server: RpcServer, deps: THandlerDeps, serverCtx: ServerHandlerContext) => void
  initializeSessionManager: (sessionManager: TSessionManager, signal: AbortSignal) => Promise<void>
  /**
   * Return once the RPC transport is ready, leaving Agent/session initialization
   * to startRuntime(). Headless hosts remain eager by default.
   */
  deferRuntimeInitialization?: boolean
  /** Failed or timed-out stop retains the lease until the host actually exits. */
  stopTimeoutMs?: number
  /** Explicit user selection, applied only after exclusive ownership. */
  restoreConfigBackup?: string
  /** Desktop preflight already owns the lease; verified before reuse. */
  reuseServerLock?: boolean
  setSessionEventSink: (sessionManager: TSessionManager, sink: EventSink) => void
  initModelRefreshService: () => ModelRefreshServiceLike
  cleanupSessionManager?: (sessionManager: TSessionManager, requestsDrained: Promise<void>) => Promise<void> | void
  cleanupClientResources?: (clientId: string) => void
  onClientConnected?: (info: { clientId: string; webContentsId: number | null; workspaceId: string | null }) => void
  serverId?: string
  /** App version string, included in handshake_ack for client compatibility checks. */
  serverVersion?: string
  /** TLS configuration. When provided, the server listens on wss:// instead of ws://. */
  tls?: WsRpcTlsOptions
  /** Cookie-based session validator for web UI auth on WebSocket upgrade. */
  validateSessionCookie?: (cookieHeader: string | null) => Promise<boolean>
  /**
   * Optional HTTP request handler for non-WebSocket requests on the RPC port.
   * When provided, the WsRpcServer serves HTTP (e.g. WebUI) on the same port.
   */
  httpHandler?: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void | Promise<void>
}

export interface ServerHandlerContext {
  getConnectedClientCount: () => number
  serverId: string
  startedAt: number
}

export interface ServerInstance<TSessionManager> {
  platform: PlatformServices
  sessionManager: TSessionManager
  wsServer: WsRpcServer
  oauthFlowStore: OAuthFlowStore
  host: string
  port: number
  protocol: 'ws' | 'wss'
  token: string
  /** Context for server-level RPC handlers (status, health, active sessions). */
  serverHandlerContext: ServerHandlerContext
  /** Resolves when SessionManager initialization and model refresh startup complete. */
  ready: Promise<void>
  /** Idempotently starts the Agent/session runtime. */
  startRuntime: () => Promise<void>
  stop: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Token entropy validation
// ---------------------------------------------------------------------------

const MIN_TOKEN_LENGTH = 16

/**
 * Reject tokens that are trivially weak. Runs at startup before the server
 * accepts connections so a bad token never reaches the wire.
 */
function validateTokenEntropy(token: string): { ok: boolean; warning?: string; error?: string } {
  if (token.length < MIN_TOKEN_LENGTH) {
    return { ok: false, error: `Token too short (${token.length} chars, minimum ${MIN_TOKEN_LENGTH}). Use a cryptographically random value.` }
  }

  // Reject single-character repeats ("aaaaaaaaaaaaaaaa")
  if (new Set(token).size === 1) {
    return { ok: false, error: 'Token has zero entropy (single repeated character).' }
  }

  // Warn (but allow) low-uniqueness tokens — fewer than 8 unique characters
  // in a 16+ char token suggests a pattern like "abcabcabc..."
  const uniqueChars = new Set(token).size
  if (uniqueChars < 8) {
    return { ok: true, warning: `Token has low entropy (${uniqueChars} unique characters). Consider using a stronger token.` }
  }

  return { ok: true }
}

/**
 * Generate a cryptographically random token suitable for server auth.
 * Returns a 48-character hex string (192 bits of entropy).
 */
export function generateServerToken(): string {
  return randomBytes(24).toString('hex')
}

// ---------------------------------------------------------------------------
// Config artifacts
// ---------------------------------------------------------------------------

function bootstrapConfigArtifacts(platform: PlatformServices): void {
  ensureConfigDir()
  platform.logger.info('[bootstrap] Config artifacts initialized')
}

function ensureGlobalConfigExists(platform: PlatformServices): void {
  const config = loadStoredConfig()
  if (config) {
    platform.logger.info('[bootstrap] Global config found')
    return
  }

  saveConfig({
    workspaces: [],
    activeWorkspaceId: null,
    activeSessionId: null,
  })
  platform.logger.info('[bootstrap] Initialized missing global config')
}

let pendingBootstrap: { options: object; promise: Promise<ServerInstance<unknown>> } | undefined

export function bootstrapServer<TSessionManager, THandlerDeps>(options: ServerBootstrapOptions<TSessionManager, THandlerDeps>): Promise<ServerInstance<TSessionManager>> {
  if (pendingBootstrap) {
    if (pendingBootstrap.options !== options) return Promise.reject(new Error('A different Host bootstrap is already in progress'))
    return pendingBootstrap.promise as Promise<ServerInstance<TSessionManager>>
  }
  const promise = startServer(options).finally(() => { pendingBootstrap = undefined })
  pendingBootstrap = { options, promise }
  return promise
}

async function startServer<TSessionManager, THandlerDeps>(
  options: ServerBootstrapOptions<TSessionManager, THandlerDeps>,
): Promise<ServerInstance<TSessionManager>> {
  const serverToken = options.serverToken ?? process.env.CRAFT_SERVER_TOKEN
  if (!serverToken) {
    throw new Error('Server token is required. Pass options.serverToken or set CRAFT_SERVER_TOKEN.')
  }

  const entropy = validateTokenEntropy(serverToken)
  if (!entropy.ok) {
    throw new Error(`Weak server token: ${entropy.error}`)
  }

  const platform = options.platformFactory?.() ?? createHeadlessPlatform({ appVersion: options.serverVersion })

  const bundledAssetsRoot = options.bundledAssetsRoot
    ?? process.env.CRAFT_BUNDLED_ASSETS_ROOT
    ?? process.cwd()
  setBundledAssetsRoot(bundledAssetsRoot)

  if (entropy.warning) {
    platform.logger.warn(`[bootstrap] ${entropy.warning}`)
  }

  options.applyPlatformToSubsystems?.(platform)

  mkdirSync(CONFIG_DIR, { recursive: true })
  if (options.reuseServerLock) {
    if (!hasServerLock()) throw new Error('Host preflight does not own the server lease')
  } else await acquireServerLock(platform.logger)
  let modelRefreshService: ModelRefreshServiceLike | undefined
  let sessionManager: TSessionManager | undefined
  let wsServer: WsRpcServer | undefined
  let oauthFlowStore: OAuthFlowStore | undefined
  let runtimeStarted = false
  let stopping: Promise<void> | undefined
  const lifetime = new AbortController()
  let resolveReady!: () => void
  let rejectReady!: (error: unknown) => void
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  // Deferred hosts may fail before they attach their readiness observer.
  void ready.catch(() => {})

  const startRuntime = (): Promise<void> => {
    if (runtimeStarted || lifetime.signal.aborted) return ready
    runtimeStarted = true
    void (async () => {
      await options.initializeSessionManager(sessionManager!, lifetime.signal)
      if (lifetime.signal.aborted) return
      modelRefreshService!.startAll()
      platform.logger.info('[bootstrap] Agent runtime initialized')
    })().then(resolveReady, rejectReady)
    return ready
  }

  const stop = (): Promise<void> => {
    if (stopping) return stopping
    lifetime.abort()
    if (!runtimeStarted) resolveReady()
    const errors: unknown[] = []
    const attempt = async (action: () => unknown | Promise<unknown>) => {
      try { await action() } catch (error) { errors.push(error) }
    }
    const cleanup = (async () => {
      // Stop admission immediately, even when initialization is hung.
      const transportClosed = attempt(() => wsServer?.close())
      await attempt(() => oauthFlowStore?.dispose())
      await attempt(() => modelRefreshService?.stopAll?.())
      await ready.catch(() => {})
      if (sessionManager !== undefined) await attempt(() => options.cleanupSessionManager?.(sessionManager!, transportClosed))
      await transportClosed
      if (errors.length) throw new AggregateError(errors, 'Host cleanup failed; ownership retained until exit')
    })()
    let deadline: ReturnType<typeof setTimeout>
    stopping = Promise.race([
      cleanup,
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(Object.assign(new Error('Host shutdown timed out; ownership retained until exit'), { code: 'STOP_TIMEOUT' })), options.stopTimeoutMs ?? 4500)
      }),
    ]).then(() => { releaseServerLock() }).finally(() => clearTimeout(deadline))
    return stopping
  }

  try {
    if (options.restoreConfigBackup) restoreStoredConfigBackup(options.restoreConfigBackup)
    // Validate before backup rotation, defaults, or migrations can touch Host data.
    loadStoredConfig()
    bootstrapConfigArtifacts(platform)
    ensureGlobalConfigExists(platform)
    seedDefaultAgentResources()
    const directoryMigration = await migrateLegacyLocalProjectDirectoryIdentities()
    for (const unresolved of directoryMigration.unresolvedProjects) {
      platform.logger.warn(`Project ${unresolved.projectId} still requires path recovery: ${unresolved.reason}`)
    }
    modelRefreshService = options.initModelRefreshService()
    sessionManager = options.createSessionManager()
    const rpcHost = options.rpcHost ?? process.env.CRAFT_RPC_HOST ?? '127.0.0.1'
    const rpcPort = options.rpcPort ?? Number(process.env.CRAFT_RPC_PORT ?? '9100')
    if (!Number.isInteger(rpcPort) || rpcPort < 0 || rpcPort > 65535) throw new Error(`Invalid RPC port: ${rpcPort}`)
    wsServer = new WsRpcServer({
      host: rpcHost, port: rpcPort, requireAuth: true,
      validateToken: async (t) => t === serverToken,
      validateSessionCookie: options.validateSessionCookie,
      serverId: options.serverId ?? 'headless', serverVersion: options.serverVersion,
      tls: options.tls, httpHandler: options.httpHandler,
      onClientConnected: options.onClientConnected,
      onClientDisconnected: (clientId) => { options.cleanupClientResources?.(clientId) },
    })
    oauthFlowStore = new OAuthFlowStore()
    const deps = options.createHandlerDeps({ sessionManager, platform, oauthFlowStore })
    const serverHandlerContext: ServerHandlerContext = {
      getConnectedClientCount: () => wsServer!.getConnectedClientCount(),
      serverId: options.serverId ?? 'headless', startedAt: Date.now(),
    }
    options.registerAllRpcHandlers(wsServer, deps, serverHandlerContext)
    options.setSessionEventSink(sessionManager, wsServer.push.bind(wsServer))
    await wsServer.listen()
    platform.logger.info(`Storyflow server listening on ${wsServer.protocol}://${rpcHost}:${wsServer.port}`)
    if (!options.deferRuntimeInitialization) await startRuntime()

    return {
      platform,
      sessionManager,
      wsServer,
      oauthFlowStore,
      host: rpcHost,
      port: wsServer.port,
      protocol: wsServer.protocol,
      token: serverToken,
      serverHandlerContext,
      ready,
      startRuntime,
      stop,
    }
  } catch (error) {
    try { await stop() } catch (cleanupError) {
      platform.logger.error('[bootstrap] Rollback incomplete; host must exit', cleanupError)
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// HTTP Health Endpoint (opt-in, for load balancers / k8s probes)
// ---------------------------------------------------------------------------

export interface HealthHttpServerOptions {
  port: number
  deps: { sessionManager: { getWorkspaces(): unknown[] } }
  wsServer: WsRpcServer
  platform: PlatformServices
}

/**
 * Start a minimal HTTP server for health/status probes.
 * Only starts if port > 0. Returns a cleanup function.
 */
export async function startHealthHttpServer(options: HealthHttpServerOptions): Promise<{ stop: () => void } | null> {
  if (options.port <= 0) return null

  // Dynamic import — getHealthCheck uses HandlerDeps shape
  const { getHealthCheck } = await import('../handlers/rpc/server')

  const depsLike = { sessionManager: options.deps.sessionManager } as any

  // Use Bun.serve if available, otherwise skip (Node.js/Electron doesn't need HTTP health)
  if (typeof globalThis.Bun !== 'undefined') {
    const server = Bun.serve({
      port: options.port,
      fetch(req: Request) {
        const path = new URL(req.url).pathname
        if (path === '/health') {
          const health = getHealthCheck(depsLike)
          return Response.json(health, {
            status: health.status === 'ok' ? 200 : 503,
          })
        }
        return new Response('Not Found', { status: 404 })
      },
    })

    options.platform.logger.info(`[bootstrap] Health endpoint listening on http://0.0.0.0:${options.port}/health`)

    return {
      stop: () => server.stop(),
    }
  }

  return null
}
