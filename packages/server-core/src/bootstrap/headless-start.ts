// input: Server transport options, Host Project registrations, and host-provided SessionManager/RPC dependencies
// output: A compatibility-upgraded, transport-ready server with an explicitly startable Agent runtime
// pos: Owns the two-stage server lifecycle shared by Electron and headless hosts

import { lstatSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { uptime as osUptime } from 'node:os'
import { join } from 'node:path'
import * as lockfile from 'proper-lockfile'
import { OAuthFlowStore } from '@craft-agent/shared/auth'
import { seedDefaultAgentResources } from '@craft-agent/shared/agent-defaults'
import { ensureConfigDir, loadStoredConfig, saveConfig } from '@craft-agent/shared/config'
import { CONFIG_DIR } from '@craft-agent/shared/config/paths'
import { setBundledAssetsRoot } from '@craft-agent/shared/utils'
import { registerLocalProject } from '@craft-agent/shared/workspaces'
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
const LEASE_PATH = join(CONFIG_DIR, '.server.lease')
const INCOMPATIBLE_LEASE_OWNER_FILE = join(LOCK_FILE, 'owner.json')
const SERVER_LEASE_VERSION = 1
const LOCK_STALE_MS = 60_000
const LOCK_UPDATE_MS = LOCK_STALE_MS / 2
const LOCK_RETRY_MS = 500
let serverLockHeld = false

interface ServerLockPayload {
  pid: number
  startedAt: number
  leaseVersion?: number
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
 * Parse the compatibility lock file. Current releases write JSON while older
 * releases may still leave a plain PID.
 */
function parseLockContent(raw: string): ServerLockPayload | null {
  const trimmed = raw.trim()
  // Try the structured format first.
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      const pid = typeof parsed.pid === 'number' ? parsed.pid : NaN
      const startedAt = typeof parsed.startedAt === 'number' ? parsed.startedAt : 0
      const leaseVersion = typeof parsed.leaseVersion === 'number' ? parsed.leaseVersion : undefined
      if (!isNaN(pid)) return { pid, startedAt, leaseVersion }
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

function isLiveForeignOwner(owner: ServerLockPayload | null): owner is ServerLockPayload {
  return owner !== null
    && owner.pid !== process.pid
    && isProcessAlive(owner.pid)
    && !isLockFromPreviousBoot(owner.startedAt)
}

function prepareCompatibilityLock(logger: PlatformServices['logger']): void {
  let stats: ReturnType<typeof lstatSync>
  try {
    stats = lstatSync(LOCK_FILE)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  // v0.17.0 briefly used the released file path as a lease directory. Migrate
  // it once, but never steal it from a live owner or an in-progress startup.
  if (stats.isDirectory()) {
    let owner: ServerLockPayload | null = null
    try {
      owner = parseLockContent(readFileSync(INCOMPATIBLE_LEASE_OWNER_FILE, 'utf-8'))
    } catch {
      // A missing owner is safe to remove only after its lease heartbeat expires.
    }

    if (isLiveForeignOwner(owner)) {
      throw new Error(`Another Storyflow server instance is active (PID ${owner.pid}). Close it and retry.`)
    }
    if (!owner && stats.mtimeMs >= Date.now() - LOCK_STALE_MS) {
      throw new Error('Another Storyflow server instance may be starting. Retry shortly.')
    }

    rmSync(LOCK_FILE, { recursive: true })
    logger.warn('[bootstrap] Migrated incompatible v0.17.0 server lease directory')
    return
  }

  if (!stats.isFile()) {
    throw new Error(`Unsupported server lock at ${LOCK_FILE}. Remove it after verifying no Storyflow server is running.`)
  }

  const legacyLock = parseLockContent(readFileSync(LOCK_FILE, 'utf-8'))

  if (legacyLock?.leaseVersion === SERVER_LEASE_VERSION) {
    const leaseActive = lockfile.checkSync(CONFIG_DIR, {
      lockfilePath: LEASE_PATH,
      realpath: false,
      stale: LOCK_STALE_MS,
    })
    if (leaseActive) {
      throw new Error(`Another Storyflow server instance is active (PID ${legacyLock.pid}). Close it and retry.`)
    }
    if (isLiveForeignOwner(legacyLock) && stats.mtimeMs >= Date.now() - LOCK_STALE_MS) {
      throw new Error('Another Storyflow server instance may be starting. Retry shortly.')
    }
  } else if (isLiveForeignOwner(legacyLock)) {
    throw new Error(
      `A legacy Storyflow server lock may still be active (PID ${legacyLock.pid}). ` +
      `Close Storyflow and retry; only delete ${LOCK_FILE} once if that PID is unrelated.`,
    )
  }

  try {
    unlinkSync(LOCK_FILE)
    logger.warn('[bootstrap] Removed stale legacy server lock')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

function removeOwnedCompatibilityLock(): void {
  try {
    const owner = parseLockContent(readFileSync(LOCK_FILE, 'utf-8'))
    if (owner?.pid === process.pid && owner.leaseVersion === SERVER_LEASE_VERSION) unlinkSync(LOCK_FILE)
  } catch {
    // Best-effort cleanup
  }
}

export async function acquireServerLock(logger: PlatformServices['logger']): Promise<void> {
  if (serverLockHeld) throw new Error('This process already owns the Storyflow server lease.')

  prepareCompatibilityLock(logger)
  try {
    writeFileSync(
      LOCK_FILE,
      JSON.stringify({ pid: process.pid, startedAt: Date.now(), leaseVersion: SERVER_LEASE_VERSION }),
      { encoding: 'utf-8', flag: 'wx' },
    )
  } catch (error) {
    if (['EEXIST', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      throw new Error('Another Storyflow server instance became active during startup. Retry shortly.')
    }
    throw error
  }

  try {
    await lockfile.lock(CONFIG_DIR, {
      lockfilePath: LEASE_PATH,
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
    serverLockHeld = true
  } catch (error) {
    removeOwnedCompatibilityLock()
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

  let leaseReleased = false
  try {
    lockfile.unlockSync(CONFIG_DIR, { lockfilePath: LEASE_PATH, realpath: false })
    leaseReleased = true
  } catch {
    // Best-effort cleanup
  } finally {
    if (leaseReleased) removeOwnedCompatibilityLock()
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

  // v0.17 already trusted each stored locator. Pin that existing content ID
  // before the RPC catalog can expose v0.18's fail-closed availability state.
  for (const project of loadStoredConfig()?.workspaces ?? []) {
    if (project.remoteServer || project.directoryConfigId) continue
    try {
      const restored = registerLocalProject(project.name, project.rootPath)
      if (restored.id !== project.id) {
        throw new Error(`The stored directory belongs to Project ${restored.id}.`)
      }
      platform.logger.info(`Restored directory identity for Project ${project.id}`)
    } catch (error) {
      platform.logger.warn(`Project ${project.id} still requires relinking:`, error)
    }
  }

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
