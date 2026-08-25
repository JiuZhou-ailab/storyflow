// input: Server transport options plus host-provided SessionManager and RPC dependencies
// output: A transport-ready server instance with an explicitly startable Agent runtime
// pos: Owns the two-stage server lifecycle shared by Electron and headless hosts

import { lstatSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { uptime as osUptime } from 'node:os'
import { join } from 'node:path'
import * as lockfile from 'proper-lockfile'
import { OAuthFlowStore } from '@craft-agent/shared/auth'
import { seedDefaultAgentResources } from '@craft-agent/shared/agent-defaults'
import { ensureConfigDir, loadStoredConfig, saveConfig } from '@craft-agent/shared/config'
import { CONFIG_DIR } from '@craft-agent/shared/config/paths'
import { setBundledAssetsRoot } from '@craft-agent/shared/utils'
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
  initializeSessionManager: (sessionManager: TSessionManager) => Promise<void>
  /**
   * Return once the RPC transport is ready, leaving Agent/session initialization
   * to startRuntime(). Headless hosts remain eager by default.
   */
  deferRuntimeInitialization?: boolean
  setSessionEventSink: (sessionManager: TSessionManager, sink: EventSink) => void
  initModelRefreshService: () => ModelRefreshServiceLike
  cleanupSessionManager?: (sessionManager: TSessionManager) => Promise<void> | void
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
  httpHandler?: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void
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
// Startup lease
// ---------------------------------------------------------------------------

const LOCK_FILE = join(CONFIG_DIR, '.server.lock')
const LOCK_OWNER_FILE = join(LOCK_FILE, 'owner.json')
const LOCK_STALE_MS = 60_000
const LOCK_UPDATE_MS = LOCK_STALE_MS / 2
const LOCK_RETRY_MS = 500
let serverLockHeld = false

interface LegacyLockPayload {
  pid: number
  startedAt: number
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Parse pre-lease lock files. Supports both the JSON format
 * (`{pid, startedAt}`) and its older plain-PID predecessor.
 */
function parseLegacyLockContent(raw: string): LegacyLockPayload | null {
  const trimmed = raw.trim()
  // Try JSON first (newer legacy format)
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      const pid = typeof parsed.pid === 'number' ? parsed.pid : NaN
      const startedAt = typeof parsed.startedAt === 'number' ? parsed.startedAt : 0
      if (!isNaN(pid)) return { pid, startedAt }
    } catch { /* fall through to legacy parse */ }
  }
  // Legacy format: plain PID number
  const pid = parseInt(trimmed, 10)
  if (!isNaN(pid)) return { pid, startedAt: 0 }
  return null
}

/**
 * Returns true if the lock's `startedAt` timestamp predates the most recent
 * system boot. This means the lock was written in a previous boot cycle and
 * the PID has been reused by an unrelated process.
 */
function isLockFromPreviousBoot(startedAt: number): boolean {
  if (startedAt <= 0) return false // legacy lock without timestamp — can't tell
  const bootTime = Date.now() - osUptime() * 1000
  return startedAt < bootTime
}

function lockPathIsDirectory(): boolean {
  try {
    return lstatSync(LOCK_FILE).isDirectory()
  } catch {
    return false
  }
}

function assertActiveLeaseIsNotOwnedByALiveProcess(): void {
  if (!lockPathIsDirectory()) return

  try {
    const owner = JSON.parse(readFileSync(LOCK_OWNER_FILE, 'utf-8')) as Partial<LegacyLockPayload>
    if (
      typeof owner.pid === 'number'
      && typeof owner.startedAt === 'number'
      && isProcessAlive(owner.pid)
      && !isLockFromPreviousBoot(owner.startedAt)
    ) {
      throw new Error(`Another Storyflow server instance is active (PID ${owner.pid}). Close it and retry.`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Another Storyflow server instance')) throw error
    // Missing or unreadable owner metadata is handled by proper-lockfile's stale lease rules.
  }
}

function migrateLegacyServerLock(logger: PlatformServices['logger']): void {
  // Remove after upgrades from pre-lease releases are no longer supported.
  let stats: ReturnType<typeof lstatSync>
  try {
    stats = lstatSync(LOCK_FILE)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  if (stats.isDirectory()) return
  if (!stats.isFile()) {
    throw new Error(`Unsupported server lock at ${LOCK_FILE}. Remove it after verifying no Storyflow server is running.`)
  }

  let legacyLock: LegacyLockPayload | null
  try {
    legacyLock = parseLegacyLockContent(readFileSync(LOCK_FILE, 'utf-8'))
  } catch (error) {
    if (lockPathIsDirectory()) return
    throw error
  }

  if (
    legacyLock
    && legacyLock.pid !== process.pid
    && isProcessAlive(legacyLock.pid)
    && !isLockFromPreviousBoot(legacyLock.startedAt)
  ) {
    throw new Error(
      `A legacy Storyflow server lock may still be active (PID ${legacyLock.pid}). ` +
      `Close Storyflow and retry; only delete ${LOCK_FILE} once if that PID is unrelated.`,
    )
  }

  try {
    unlinkSync(LOCK_FILE)
    logger.warn('[bootstrap] Removed stale legacy server lock')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || lockPathIsDirectory()) return
    throw error
  }
}

export async function acquireServerLock(logger: PlatformServices['logger']): Promise<void> {
  if (serverLockHeld) throw new Error('This process already owns the Storyflow server lease.')

  migrateLegacyServerLock(logger)
  assertActiveLeaseIsNotOwnedByALiveProcess()

  try {
    await lockfile.lock(CONFIG_DIR, {
      lockfilePath: LOCK_FILE,
      realpath: false,
      stale: LOCK_STALE_MS,
      update: LOCK_UPDATE_MS,
      retries: {
        retries: LOCK_STALE_MS / LOCK_RETRY_MS,
        factor: 1,
        minTimeout: LOCK_RETRY_MS,
        maxTimeout: LOCK_RETRY_MS,
        randomize: false,
      },
      onCompromised(error) {
        logger.error('[bootstrap] Server lease was compromised; exiting to prevent concurrent writers', error)
        process.exit(1)
      },
    })
    try {
      writeFileSync(LOCK_OWNER_FILE, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), 'utf-8')
      serverLockHeld = true
    } catch (error) {
      try {
        lockfile.unlockSync(CONFIG_DIR, { lockfilePath: LOCK_FILE, realpath: false })
      } catch {
        // Best-effort cleanup before surfacing the acquisition failure.
      }
      throw error
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOCKED') {
      throw new Error('Another Storyflow server instance is active. Close it and retry.')
    }
    throw error
  }
}

/**
 * Release the lease if it belongs to the current process.
 * Exported so consumers (e.g. the Electron before-quit handler) can call it
 * directly without going through `instance.stop()`.
 */
export function releaseServerLock(): void {
  if (!serverLockHeld) return

  try {
    lockfile.unlockSync(CONFIG_DIR, { lockfilePath: LOCK_FILE, realpath: false })
  } catch {
    // Best-effort cleanup
  } finally {
    serverLockHeld = false
  }
}

// A normal process exit permits synchronous lock cleanup; SIGKILL still relies
// on proper-lockfile's stale lease recovery and owner-PID guard.
process.on('exit', releaseServerLock)

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

export async function bootstrapServer<TSessionManager, THandlerDeps>(
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

  bootstrapConfigArtifacts(platform)
  await acquireServerLock(platform.logger)
  try {
  seedDefaultAgentResources()
  ensureGlobalConfigExists(platform)

  const modelRefreshService = options.initModelRefreshService()
  const sessionManager = options.createSessionManager()

  const rpcHost = options.rpcHost ?? process.env.CRAFT_RPC_HOST ?? '127.0.0.1'
  const rpcPortRaw = options.rpcPort ?? parseInt(process.env.CRAFT_RPC_PORT ?? '9100', 10)
  if (!Number.isFinite(rpcPortRaw) || rpcPortRaw < 0 || rpcPortRaw > 65535) {
    throw new Error(`Invalid RPC port: ${rpcPortRaw}`)
  }
  const rpcPort = Math.trunc(rpcPortRaw)

  const wsServer = new WsRpcServer({
    host: rpcHost,
    port: rpcPort,
    requireAuth: true,
    validateToken: async (t) => t === serverToken,
    validateSessionCookie: options.validateSessionCookie,
    serverId: options.serverId ?? 'headless',
    serverVersion: options.serverVersion,
    tls: options.tls,
    httpHandler: options.httpHandler,
    onClientConnected: options.onClientConnected,
    onClientDisconnected: (clientId) => {
      options.cleanupClientResources?.(clientId)
    },
  })

  await wsServer.listen()

  const oauthFlowStore = new OAuthFlowStore()

  const deps = options.createHandlerDeps({
    sessionManager,
    platform,
    oauthFlowStore,
  })

  const startedAt = Date.now()
  const serverHandlerContext: ServerHandlerContext = {
    getConnectedClientCount: () => wsServer.getConnectedClientCount(),
    serverId: options.serverId ?? 'headless',
    startedAt,
  }

  options.registerAllRpcHandlers(wsServer, deps, serverHandlerContext)

  options.setSessionEventSink(sessionManager, wsServer.push.bind(wsServer))

  platform.logger.info(`Storyflow server listening on ${wsServer.protocol}://${rpcHost}:${wsServer.port}`)

  let stopped = false
  let runtimeStarted = false
  let resolveReady!: () => void
  let rejectReady!: (error: unknown) => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })

  const startRuntime = (): Promise<void> => {
    if (runtimeStarted) return ready
    runtimeStarted = true

    void (async () => {
      await options.initializeSessionManager(sessionManager)
      if (stopped) return
      modelRefreshService.startAll()
      platform.logger.info('[bootstrap] Agent runtime initialized')
    })().then(resolveReady, rejectReady)

    return ready
  }

  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true

    if (!runtimeStarted) {
      runtimeStarted = true
      resolveReady()
    } else {
      // Do not dispose resources while an in-flight initialization still owns them.
      await ready.catch(() => {})
    }

    platform.logger.info('Shutting down...')

    // Notify connected clients before closing connections
    try {
      wsServer.push('server:shuttingDown', { to: 'all' }, {
        reason: 'shutdown',
        graceMs: 2000,
        timestamp: Date.now(),
      })
      // Brief drain period so clients receive the notification
      await new Promise(resolve => setTimeout(resolve, 2000))
    } catch (error) {
      platform.logger.error('[bootstrap] Failed to send shutdown notification:', error)
    }

    try {
      modelRefreshService.stopAll?.()
    } catch (error) {
      platform.logger.error('[bootstrap] Failed to stop model refresh service:', error)
    }

    try {
      await options.cleanupSessionManager?.(sessionManager)
    } catch (error) {
      platform.logger.error('[bootstrap] Failed to clean up session manager:', error)
    }

    try {
      wsServer.close()
    } catch (error) {
      platform.logger.error('[bootstrap] Failed to close WS server:', error)
    }

    try {
      oauthFlowStore.dispose()
    } catch (error) {
      platform.logger.error('[bootstrap] Failed to dispose OAuth flow store:', error)
    }

    releaseServerLock()
  }

  if (!options.deferRuntimeInitialization) {
    try {
      await startRuntime()
    } catch (error) {
      await stop()
      throw error
    }
  }

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
    releaseServerLock()
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
