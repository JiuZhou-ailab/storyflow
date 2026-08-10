// input: Workspace sessions, Pi product projections, persistence stores, and Host services
// output: Durable product session state, projected Pi events, and explicit user commands
// pos: Storyflow Product Host session boundary; Pi owns Agent turn execution

import type { EventSink } from '@craft-agent/server-core/transport'
import type { ISessionManager, IBrowserPaneManager, ExecutePromptAutomationInput } from '@craft-agent/server-core/handlers'
import { validateFilePath, getWorkspaceAllowedDirs } from '@craft-agent/server-core/handlers'
import { createScopedLogger, CONSOLE_LOGGER, type PlatformServices, type Logger } from '@craft-agent/server-core/runtime'
import { basename, join } from 'path'
import { existsSync, readdirSync } from 'fs'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { PiAgent, type AgentEvent, setPermissionMode, hydratePreviousPermissionMode, getPermissionModeDiagnostics, type PermissionMode, unregisterSessionScopedToolCallbacks, mergeSessionScopedToolCallbacks, AbortReason, type AuthRequest, type AuthResult, type CredentialAuthRequest, type BrowserPaneFns, generateConversationSummary } from '@craft-agent/shared/agent'
import type { UserQuestionRequest, UserQuestionResponse } from '@craft-agent/session-tools-core'
import {
  resolveSessionConnection,
  resolveBackendContext,
  resolvePiAgentConfig,
  cleanupSourceRuntimeArtifacts,
  type BackendHostRuntimeContext,
} from '@craft-agent/shared/agent/backend'
import type {
  ConversationRewindRequest,
  ConversationRewindResult,
  ManagedModelAccess,
} from '@craft-agent/shared/agent/backend/types'
import { getLlmConnection, getLlmConnections, getDefaultLlmConnection, getDefaultThinkingLevel, getEnable1MContext, getExtendedPromptCache, normalizeLlmConnectionSlug, resetManagedAnthropicAuthEnvVars } from '@craft-agent/shared/config'
import { PrivilegedExecutionBroker } from '@craft-agent/server-core/services'
import { isValidWorkingDirectory } from '../utils/path-validation'
import { InitGate, orderWorkspacesByActiveFirst } from '@craft-agent/server-core/domain'
import {
  getWorkspaces,
  getActiveWorkspace,
  getWorkspaceByNameOrId,
  loadConfigDefaults,
  migrateLegacyCredentials,
  migrateLegacyLlmConnectionsConfig,
  migrateOrphanedDefaultConnections,
  seedBuiltinLlmConnectionFromDefaults,
  MODEL_REGISTRY,
  type Workspace,
  type WorkspaceInfo,
} from '@craft-agent/shared/config'
import type { ActiveSessionInfo, SessionProcessingStatus } from '@craft-agent/core/types'
import { loadWorkspaceConfig } from '@craft-agent/shared/workspaces'
import {
  isFreeConversationWorkspaceId,
  listSessionWorkspaces,
  resolveRuntimeWorkspace,
} from '@craft-agent/shared/workspaces'
import {
  // Session persistence functions
  listSessionsAsync as listStoredSessions,
  loadSession as loadStoredSession,
  saveSession as saveStoredSession,
  createSession as createStoredSession,
  deleteSession as deleteStoredSession,
  updateSessionMetadata,
  setPendingPlanExecution as setStoredPendingPlanExecution,
  markCompactionComplete as markStoredCompactionComplete,
  markPendingPlanExecutionDispatched as markStoredPendingPlanExecutionDispatched,
  clearPendingPlanExecution as clearStoredPendingPlanExecution,
  getPendingPlanExecution as getStoredPendingPlanExecution,
  getSessionPath as getSessionStoragePath,
  ensureSessionDir,
  getSessionFilePath,
  generateSessionId,
  sessionPersistenceQueue,
  getHeaderMetadataSignature,
  writeSessionJsonl,
  serializeSession,
  validateBundle,
  type SessionBundle,
  type DispatchMode,
  type StoredSession,
  type StoredMessage,
  type SessionStatus,
  type SessionHeader,
  type LegacyAgentRuntime,
  pickSessionFields,
} from '@craft-agent/shared/sessions'
import { loadWorkspaceSources, loadAllSources, getSourcesBySlugs, isSourceUsable, type LoadedSource, getSourceCredentialManager, getSourceServerBuilder, type SourceWithCredential, isApiOAuthProvider, hasRenewEndpoint, SERVER_BUILD_ERRORS, TokenRefreshManager, createTokenGetter, createStoryflowManagedTokenGetter, getTrustedManagedSourcePolicy } from '@craft-agent/shared/sources'
import { ConfigWatcher, type ConfigWatcherCallbacks } from '@craft-agent/shared/config'
import { resolveAuthEnvVars } from '@craft-agent/shared/config'
import { getLastApiError } from '@craft-agent/shared/provider-diagnostics'
import { isParentTaskTool } from '@craft-agent/shared/utils/toolNames'
import { isLowSignal } from '@craft-agent/shared/utils'
import { restoreFiles } from '@craft-agent/shared/utils/bundle-files'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { McpClientPool } from '@craft-agent/shared/mcp'
import { type Session, type SessionEvent, type FileAttachment, type SendMessageOptions, type OneShotLlmRequest, type OneShotLlmResult, type NovelSelectionRewriteRequest, type NovelSelectionRewriteResult, type UnreadSummary, type RemoteSessionTransferPayload, RPC_CHANNELS, generateMessageId } from '@craft-agent/shared/protocol'
import { messageToStored, storedToMessage, type Message, type StoredAttachment, type ToolDisplayMeta, type TurnMetrics, type TurnUsage } from '@craft-agent/core/types'
import { formatPathsToRelative, formatToolInputPaths, perf, readFileAttachment, selectSpreadMessages, normalizePath } from '@craft-agent/shared/utils'
import { getCurrentLanguageName } from '@craft-agent/shared/i18n'
import { buildNovelSelectionRewritePrompt, sanitizeNovelSelectionReplacement } from '@craft-agent/shared/writing'
import { loadPiSkillCatalog, invalidateSkillsCache } from '@craft-agent/shared/skills'
import { invalidateContextFileCache } from '@craft-agent/shared/prompts/system'
import { getMiniModel } from '@craft-agent/shared/config'
import { getDefaultSummarizationModel } from '@craft-agent/shared/config/models'
import type { SummarizeCallback } from '@craft-agent/shared/sources'
import { type ThinkingLevel, normalizeThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'
import { evaluateAutoLabels } from '@craft-agent/shared/labels/auto'
import { listLabels, loadLabelConfig } from '@craft-agent/shared/labels/storage'
import { resolveSessionLabels } from '@craft-agent/shared/labels'
import { ensureLabelsExist } from '@craft-agent/shared/labels/crud'
import { loadStatusConfig } from '@craft-agent/shared/statuses/storage'
import { AutomationSystem, canonicalizeSkillReferences, createPromptHistoryEntry, appendAutomationHistoryEntry } from '@craft-agent/shared/automations'
import { buildBackendRuntimeSignature, buildRestartRequiredSignature, filterAttachmentsForModelInput, resetPortableForkRuntime } from './runtime-config'
import { captureWriteOriginalContent } from './write-original-content'
import {
  consumePendingSdkFork,
  clearSdkForkFields,
  createManagedSessionState,
  DEFAULT_TOKEN_USAGE,
  hasPersistedAssistantBranchability,
  managedToSession,
  resolveLiveAssistantBranchability,
  resolveManagedConnectionSlug,
  resolveSupportsBranching,
  type AgentInstance,
  type ManagedSession,
} from './managed-session'
import { getPiTurnAnchor, loadPiTurnAnchors, requireSdkForkBranchAnchor, savePiTurnAnchor } from './pi-turn-anchors'
import { resolveToolDisplayMeta } from './tool-display'
export { consumePendingSdkFork } from './managed-session'
import { SESSION_TURN_HARD_TIMEOUT_MS, TurnWatchdog, type TurnWatchdogTimeout } from './turn-watchdog'
import {
  isManagedDefaultGatewayConnection,
  MANAGED_MODEL_ACCESS_UNAVAILABLE_MESSAGE,
  normalizeManagedDefaultGatewayAuthError,
} from './managed-gateway-auth-error'

// Import from server-core domain utilities
import { sanitizeForTitle, shouldActivateBrowserOverlay, rollbackFailedBranchCreation, releaseBrowserOwnershipOnForcedStop, canSwitchSessionModelConnection } from '@craft-agent/server-core/domain'
import { resizeImageForAPI } from '@craft-agent/server-core/services'
export { sanitizeForTitle }

// Module-level platform ref — set once during init via setSessionPlatform()
let _platform: PlatformServices | null = null

// Scoped logger — upgraded from console fallback when setSessionPlatform() is called.
// Named `sessionLog` so all ~30 existing call sites remain unchanged.
let sessionLog: Logger = createScopedLogger(CONSOLE_LOGGER, 'session')

function getResourceProjectRoot(workspace: Workspace): string | undefined {
  return isFreeConversationWorkspaceId(workspace.id)
    ? undefined
    : workspace.rootPath
}

function hasPersistedPiTranscript(sessionPath: string): boolean {
  const piSessionsPath = join(sessionPath, '.pi-sessions')
  if (!existsSync(piSessionsPath)) return false
  try {
    return readdirSync(piSessionsPath, { withFileTypes: true })
      .some(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
  } catch {
    return false
  }
}

export function setSessionPlatform(platform: PlatformServices): void {
  _platform = platform
  sessionLog = createScopedLogger(platform.logger, 'session')
}

interface SessionRuntimeHooks {
  updateBadgeCount: (count: number) => void
  captureException: (error: unknown, context?: { errorSource?: string; sessionId?: string }) => void
  onSessionStarted: () => void
  onSessionStopped: () => void
  ensureManagedModelAccessToken: (
    forceRefresh?: boolean,
  ) => Promise<ManagedModelAccess & { refreshed: boolean }>
  /**
   * Resolves once the environment agent subprocesses inherit (notably PATH) is
   * ready. Hosts that must discover a login shell start that work at boot and
   * await it here, so session discovery is not serialized behind it.
   */
  whenSubprocessEnvReady: () => Promise<void>
}

const defaultSessionRuntimeHooks: SessionRuntimeHooks = {
  updateBadgeCount: () => {},
  onSessionStarted: () => {},
  onSessionStopped: () => {},
  ensureManagedModelAccessToken: async () => {
    throw new Error(MANAGED_MODEL_ACCESS_UNAVAILABLE_MESSAGE)
  },
  whenSubprocessEnvReady: async () => {},
  captureException: (error, context) => {
    const err = error instanceof Error ? error : new Error(String(error))
    if (_platform?.captureError) {
      _platform.captureError(err)
      return
    }
    sessionLog.error('[runtime-hooks] captureException fallback:', {
      errorSource: context?.errorSource,
      sessionId: context?.sessionId,
      message: err.message,
      stack: err.stack,
    })
  },
}

let sessionRuntimeHooks: SessionRuntimeHooks = defaultSessionRuntimeHooks

export function setSessionRuntimeHooks(hooks: Partial<SessionRuntimeHooks>): void {
  sessionRuntimeHooks = {
    ...sessionRuntimeHooks,
    ...hooks,
  }
}

function buildBackendHostRuntimeContext(): BackendHostRuntimeContext {
  if (!_platform) throw new Error('setSessionPlatform() must be called before session creation')
  return {
    appRootPath: _platform.appRootPath,
    resourcesPath: _platform.resourcesPath,
    isPackaged: _platform.isPackaged,
  }
}

/**
 * Feature flags for agent behavior
 */
export const AGENT_FLAGS = {
  /** Default modes enabled for new sessions */
  defaultModesEnabled: true,
} as const

const MAX_ADMIN_REMEMBER_MINUTES = 60
const MAX_ANNOTATIONS_PER_MESSAGE = 200
const MAX_ANNOTATION_JSON_BYTES = 32 * 1024

// Window during which fs.watch metadata-revert events from our own atomic write
// are ignored, so the watcher does not roll back the in-memory mutation we
// just persisted. See onSessionMetadataChange.
const METADATA_WRITE_GUARD_MS = 5000

/**
 * Text sent to the session when a plan is approved from outside the desktop
 * UI (e.g. Telegram button). Mirrors the English `plan.approved` i18n key
 * used by the desktop flow at `plan-approval-message.ts`. Not localized —
 * the agent reads this, not the end user.
 */
const PLAN_APPROVAL_MESSAGE = 'Plan approved, please execute.'

// validateSpawnAttachmentPath removed — use shared validateFilePath from @craft-agent/server-core/handlers

async function buildServersFromSources(
  sources: LoadedSource[],
  sessionPath?: string,
  tokenRefreshManager?: TokenRefreshManager,
  summarize?: SummarizeCallback
) {
  const span = perf.span('sources.buildServers', { count: sources.length })
  const credManager = getSourceCredentialManager()
  const serverBuilder = getSourceServerBuilder()

  // Load credentials for all sources
  const sourcesWithCreds: SourceWithCredential[] = await Promise.all(
    sources.map(async (source) => source.config.api?.authType === 'managed'
      ? { source, token: null, credential: null }
      : {
          source,
          token: await credManager.getToken(source),
          credential: await credManager.getApiCredential(source),
        })
  )
  span.mark('credentials.loaded')

  // Build token getter for refreshable sources (OAuth + renew-endpoint)
  // Uses TokenRefreshManager for unified refresh logic (DRY principle)
  const getTokenForSource = (source: LoadedSource) => {
    const provider = source.config.provider
    if (source.config.api?.authType === 'managed') {
      const policy = getTrustedManagedSourcePolicy(source)
      return createStoryflowManagedTokenGetter({
        expectedGatewayBaseUrl: policy.gatewayBaseUrl,
      })
    }
    // Provider-specific OAuth (Google, Slack, Microsoft) or generic OAuth (authType: 'oauth')
    if (isApiOAuthProvider(provider) || source.config.api?.authType === 'oauth') {
      const manager = tokenRefreshManager ?? new TokenRefreshManager(credManager, {
        log: (msg) => sessionLog.debug(msg),
      })
      return createTokenGetter(manager, source)
    }
    // API renew endpoint — non-OAuth token refresh
    if (hasRenewEndpoint(source)) {
      const manager = tokenRefreshManager ?? new TokenRefreshManager(credManager, {
        log: (msg) => sessionLog.debug(msg),
      })
      return createTokenGetter(manager, source)
    }
    return undefined
  }

  // Pass sessionPath to enable saving large API responses to session folder
  const result = await serverBuilder.buildAll(sourcesWithCreds, getTokenForSource, sessionPath, summarize)
  span.mark('servers.built')
  span.setMetadata('mcpCount', Object.keys(result.mcpServers).length)
  span.setMetadata('apiCount', Object.keys(result.apiServers).length)

  // Update source configs for auth errors so UI reflects actual state.
  // Re-classify AUTH_REQUIRED → TOKEN_EXPIRED when the credential is merely
  // expired-but-refreshable; in that case the refresh cycle handles recovery
  // and we must NOT prematurely mark the source as needing re-auth (#710).
  for (const error of result.errors) {
    if (error.error !== SERVER_BUILD_ERRORS.AUTH_REQUIRED) continue
    const source = sources.find(s => s.config.slug === error.sourceSlug)
    if (!source) continue

    const cred = await credManager.load(source)
    const isExpiredRefreshable =
      cred &&
      (credManager.isExpired(cred) || credManager.needsRefresh(cred)) &&
      (cred.refreshToken || hasRenewEndpoint(source))

    if (isExpiredRefreshable) {
      error.error = SERVER_BUILD_ERRORS.TOKEN_EXPIRED
      sessionLog.debug(`Source ${error.sourceSlug}: TOKEN_EXPIRED — refresh cycle will handle`)
      continue
    }

    credManager.markSourceNeedsReauth(source, 'Token missing or expired')
    sessionLog.info(`Marked source ${error.sourceSlug} as needing re-auth`)
  }

  span.end()
  return result
}

/**
 * Result of expired-credential refresh.
 */
interface RefreshExpiredCredentialsResult {
  /** Number of sources whose tokens were successfully refreshed */
  refreshedCount: number
  /** Sources that failed to refresh (for warning display) */
  failedSources: Array<{ slug: string; reason: string }>
}

/**
 * Refresh expired OAuth / renew-endpoint tokens for the given sources.
 *
 * Side effects (carried by `TokenRefreshManager.ensureFreshToken`):
 * - Success: source.config.isAuthenticated = true (in-memory + on disk).
 * - Failure: source.config.isAuthenticated = false + connectionStatus = 'needs_auth'
 *   (in-memory + on disk), so isSourceUsable() returns false and the source is
 *   excluded from intendedSlugs by callers.
 *
 * The caller is responsible for building servers AFTER this returns — that way
 * a single fresh build sees the correct credentials and the correct usable set.
 * Issue #710.
 */
async function refreshExpiredCredentials(
  sources: LoadedSource[],
  tokenRefreshManager: TokenRefreshManager
): Promise<RefreshExpiredCredentialsResult> {
  sessionLog.debug('[OAuth] Checking if any tokens need refresh')

  const needRefresh = await tokenRefreshManager.getSourcesNeedingRefresh(sources)
  if (needRefresh.length === 0) {
    return { refreshedCount: 0, failedSources: [] }
  }

  sessionLog.debug(`[OAuth] Refreshing ${needRefresh.length} source(s): ${needRefresh.map(s => s.config.slug).join(', ')}`)

  const { refreshed, failed } = await tokenRefreshManager.refreshSources(needRefresh)

  const failedSources = failed.map(({ source, reason }) => ({
    slug: source.config.slug,
    reason,
  }))

  return { refreshedCount: refreshed.length, failedSources }
}

/**
 * Apply source runtime updates for backends that need them.
 * Delegates to the backend's own applyBridgeUpdates() method.
 * Each backend handles its own strategy via applyBridgeUpdates().
 */
async function applyBridgeUpdates(
  agent: AgentInstance,
  sessionPath: string,
  enabledSources: LoadedSource[],
  mcpServers: Record<string, import('@craft-agent/shared/agent/backend').SdkMcpServerConfig>,
  sessionId: string,
  workspaceRootPath: string,
  context: string
): Promise<void> {
  await agent.applyBridgeUpdates({
    sessionPath,
    enabledSources,
    mcpServers,
    sessionId,
    workspaceRootPath,
    context,
  })
}

/**
 * Resolve tool display metadata for a tool call.
 * Returns metadata with base64-encoded icon for viewer compatibility.
 *
 * @param toolName - Tool name from the event (e.g., "Skill", "mcp__linear__list_issues")
 * @param toolInput - Tool input (used for Skill tool to get skill identifier)
 * @param workspaceRootPath - Path to workspace for loading skills/sources
 * @param sources - Loaded sources for the workspace
 */
export function createManagedSession(
  source: { id: string; agentRuntime?: LegacyAgentRuntime; legacyAgentRuntime?: LegacyAgentRuntime } & Partial<ManagedSession>,
  workspace: Workspace,
  overrides?: Partial<ManagedSession>,
): ManagedSession {
  return createManagedSessionState(source, workspace, overrides, message => sessionLog.debug(message));
}

// Performance: Batch IPC delta events to reduce renderer load
const DELTA_BATCH_INTERVAL_MS = 50  // Flush batched deltas every 50ms

interface PendingDelta {
  delta: string
  turnId?: string
}

export class SessionManager implements ISessionManager {
  private sessions: Map<string, ManagedSession> = new Map()
  // Delta batching for performance - reduces IPC events from 50+/sec to ~20/sec
  private pendingDeltas: Map<string, PendingDelta> = new Map()
  private deltaFlushTimers: Map<string, NodeJS.Timeout> = new Map()
  // Config watchers for live updates (sources, etc.) - one per workspace
  private configWatchers: Map<string, ConfigWatcher> = new Map()
  // Automation systems for workspace event automations - one per workspace (includes scheduler, diffing, and handlers)
  private automationSystems: Map<string, AutomationSystem> = new Map()
  // Pending credential request resolvers (keyed by requestId)
  private pendingCredentialResolvers: Map<string, (response: import('@craft-agent/shared/protocol').CredentialResponse) => void> = new Map()
  // Permission request metadata tracking (keyed by requestId)
  private pendingPermissionRequests: Map<string, {
    sessionId: string
    type?: 'bash' | 'file_write' | 'mcp_mutation' | 'api_mutation' | 'admin_approval'
    commandHash?: string
  }> = new Map()
  private pendingUserQuestions = new Map<string, {
    sessionId: string
    resolve: (response: UserQuestionResponse) => void
  }>()

  private cancelPendingUserQuestionsForSession(sessionId: string): void {
    for (const [requestId, pending] of this.pendingUserQuestions) {
      if (pending.sessionId !== sessionId) continue
      pending.resolve({ answers: {}, cancelled: true })
      this.pendingUserQuestions.delete(requestId)
    }
  }
  // Privileged approval binding + audit logger
  private privilegedExecutionBroker = new PrivilegedExecutionBroker(sessionLog)
  // Session-local admin remember windows (exact command hash binding)
  private adminRememberApprovals: Map<string, {
    createdAt: number
    expiresAt: number
    sourceRequestId: string
  }> = new Map()
  // Promise deduplication for lazy-loading messages (prevents race conditions)
  private messageLoadingPromises: Map<string, Promise<void>> = new Map()
  /**
   * Track which session the user is actively viewing (per workspace).
   * Map of workspaceId -> sessionId. Used to determine if a session should be
   * marked as unread when assistant completes - if user is viewing it, don't mark unread.
   */
  private activeViewingSession: Map<string, string> = new Map()
  /** Coordinates startup initialization waiters from IPC handlers. */
  private initGate = new InitGate()
  // O(1) index: taskId → sessionId for background task output lookup (avoids O(n) session scan)
  private taskOutputIndex: Map<string, string> = new Map()
  /** Serializes runtime acquisition and exclusive control-plane mutations per session. */
  private agentRuntimeLocks: Map<string, Promise<void>> = new Map()
  /** Active compatible operations sharing one stable Pi subprocess. */
  private agentRuntimeLeaseCounts: Map<string, number> = new Map()
  /** Exclusive mutations wait here until every active operation releases the subprocess. */
  private agentRuntimeLeaseWaiters: Map<string, Set<() => void>> = new Map()
  /** Monotonic clock to ensure strictly increasing message timestamps */
  private lastTimestamp = 0

  /**
   * Optional binder installed by the messaging-gateway bootstrap. When set,
   * `executePromptAutomation` calls it after creating a session whose matcher
   * declared `telegramTopic`, so the new session is bound to a Telegram forum
   * topic in the workspace's paired supergroup. Best-effort — failures must
   * not block the session.
   */
  private automationBinder?: (input: {
    workspaceId: string
    sessionId: string
    topicName: string
  }) => Promise<void>

  /**
   * Centralized setter for session processing state.
   * Automatically notifies the power manager on transitions (true→false, false→true)
   * so callers don't need to remember to call onSessionStarted/onSessionStopped.
   */
  private setProcessing(managed: ManagedSession, processing: boolean): void {
    const was = managed.isProcessing
    managed.isProcessing = processing
    if (!was && processing) {
      sessionRuntimeHooks.onSessionStarted()
    } else if (was && !processing) {
      sessionRuntimeHooks.onSessionStopped()
    }
  }

  private handleTurnWatchdogTimeout(sessionId: string, generation: number, timeout: TurnWatchdogTimeout): void {
    const managed = this.sessions.get(sessionId)
    if (!managed || !managed.isProcessing || managed.processingGeneration !== generation) return

    const minutes = Math.max(1, Math.round(timeout.elapsedMs / 60000))
    const timeoutMessage: Message = {
      id: generateMessageId(),
      role: 'error',
      content: `Agent turn exceeded the ${minutes}-minute safety limit.`,
      timestamp: this.monotonic(),
      errorCode: 'turn_timeout',
      errorTitle: 'Turn Timed Out',
      errorCanRetry: true,
    }

    sessionLog.warn('Turn watchdog timed out; forcing processing cleanup', {
      sessionId,
      reason: timeout.reason,
      elapsedMs: timeout.elapsedMs,
      generation,
    })

    managed.messages.push(timeoutMessage)
    this.sendEvent({
      type: 'error',
      sessionId,
      error: timeoutMessage.content,
      timestamp: timeoutMessage.timestamp,
    }, managed.workspace.id)
    managed.agent?.forceAbort(AbortReason.Timeout)
    void this.onProcessingStopped(sessionId, 'timeout').catch(error => {
      sessionLog.error('Failed to stop processing after turn timeout:', error)
    })
  }

  /** Wait until initialize() has completed (sessions loaded from disk).
   *  Resolves immediately if already initialized. */
  waitForInit(scopeWorkspaceId?: string | null): Promise<void> {
    // ADR 0013: a scoped waiter only needs its own workspace's sessions indexed.
    return this.initGate.waitFor(scopeWorkspaceId)
  }

  /**
   * Install the automation→topic binder. Wired by the messaging-gateway
   * bootstrap so SessionManager doesn't need to import the messaging
   * package (avoids a package-level circular dependency).
   */
  setAutomationBinder(
    fn: (input: { workspaceId: string; sessionId: string; topicName: string }) => Promise<void>,
  ): void {
    this.automationBinder = fn
  }

  private browserPaneManager: IBrowserPaneManager | null = null
  private eventSink: EventSink | null = null
  private pendingGlobalBroadcasts = new Set<string>()

  setEventSink(sink: EventSink): void {
    this.eventSink = sink
  }

  private broadcastGlobalOnce(key: string, send: () => void): void {
    if (!this.eventSink || this.pendingGlobalBroadcasts.has(key)) return
    this.pendingGlobalBroadcasts.add(key)
    queueMicrotask(() => {
      this.pendingGlobalBroadcasts.delete(key)
      if (this.eventSink) send()
    })
  }

  setBrowserPaneManager(bpm: IBrowserPaneManager): void {
    this.browserPaneManager = bpm
    bpm.setSessionPathResolver((sessionId) => this.getSessionPath(sessionId))
  }

  /** Returns a strictly increasing timestamp (ms). When Date.now() collides with
   *  the previous value, increments by 1 to preserve event ordering. */
  private monotonic(): number {
    const now = Date.now()
    this.lastTimestamp = now > this.lastTimestamp ? now : this.lastTimestamp + 1
    return this.lastTimestamp
  }

  private getAdminRememberKey(sessionId: string, commandHash: string): string {
    return `${sessionId}:${commandHash}`
  }

  private hasActiveAdminRememberApproval(sessionId: string, commandHash: string): boolean {
    const key = this.getAdminRememberKey(sessionId, commandHash)
    const entry = this.adminRememberApprovals.get(key)
    if (!entry) {
      return false
    }

    if (Date.now() > entry.expiresAt) {
      this.adminRememberApprovals.delete(key)
      this.privilegedExecutionBroker.auditEvent('privileged_remember_window_expired', {
        sessionId,
        commandHash,
        sourceRequestId: entry.sourceRequestId,
        expiresAt: entry.expiresAt,
      })
      return false
    }

    return true
  }

  private storeAdminRememberApproval(sessionId: string, commandHash: string, sourceRequestId: string, rememberForMinutes: number): void {
    const boundedMinutes = Math.min(Math.max(Math.floor(rememberForMinutes), 1), MAX_ADMIN_REMEMBER_MINUTES)
    const now = Date.now()
    const expiresAt = now + boundedMinutes * 60 * 1000

    this.adminRememberApprovals.set(this.getAdminRememberKey(sessionId, commandHash), {
      createdAt: now,
      expiresAt,
      sourceRequestId,
    })

    this.privilegedExecutionBroker.auditEvent('privileged_remember_window_stored', {
      sessionId,
      commandHash,
      sourceRequestId,
      rememberForMinutes: boundedMinutes,
      createdAt: now,
      expiresAt,
    })
  }

  private clearAdminRememberApprovalsForSession(sessionId: string): void {
    const prefix = `${sessionId}:`
    for (const key of this.adminRememberApprovals.keys()) {
      if (key.startsWith(prefix)) {
        this.adminRememberApprovals.delete(key)
      }
    }
  }

  private clearPendingPermissionRequestsForSession(sessionId: string): void {
    for (const [requestId, metadata] of this.pendingPermissionRequests.entries()) {
      if (metadata.sessionId === sessionId) {
        this.pendingPermissionRequests.delete(requestId)
      }
    }
  }

  /**
   * Apply external session header metadata to in-memory state and emit UI events.
   * Returns true if any in-memory metadata field changed.
   */
  private applyExternalSessionMetadata(managed: ManagedSession, header: SessionHeader): boolean {
    const sessionId = managed.id
    let changed = false

    // Labels
    const oldLabels = JSON.stringify(managed.labels ?? [])
    const newLabels = JSON.stringify(header.labels ?? [])
    if (oldLabels !== newLabels) {
      managed.labels = header.labels
      this.sendEvent({ type: 'labels_changed', sessionId, labels: header.labels ?? [] }, managed.workspace.id)
      changed = true
    }

    // Flagged
    if ((managed.isFlagged ?? false) !== (header.isFlagged ?? false)) {
      managed.isFlagged = header.isFlagged ?? false
      this.sendEvent(
        { type: header.isFlagged ? 'session_flagged' : 'session_unflagged', sessionId },
        managed.workspace.id
      )
      changed = true
    }

    // Session status
    if (managed.sessionStatus !== header.sessionStatus) {
      managed.sessionStatus = header.sessionStatus
      this.sendEvent({ type: 'session_status_changed', sessionId, sessionStatus: header.sessionStatus ?? '' }, managed.workspace.id)
      changed = true
    }

    // Name
    if (managed.name !== header.name) {
      managed.name = header.name
      this.sendEvent({ type: 'name_changed', sessionId, name: header.name }, managed.workspace.id)
      changed = true
    }

    if (changed) {
      sessionLog.info(`External metadata change detected for session ${sessionId}`)

      // Prevent stale pending writes from reverting externally-updated metadata.
      sessionPersistenceQueue.cancel(sessionId)
      this.persistSession(managed)
    }

    return changed
  }

  /**
   * Set up ConfigWatcher for a workspace to broadcast live updates
   * (sources added/removed, guide.md changes, etc.)
   * Called eagerly at boot for all workspaces (automations/scheduler) and
   * on client connect (GET_WORKSPACE / SWITCH_WORKSPACE).
   * Idempotent — returns immediately if already watching.
   * workspaceId must be the global config ID (what the renderer knows).
   */
  setupConfigWatcher(workspaceRootPath: string, workspaceId: string): void {
    // Check if already watching this workspace
    if (this.configWatchers.has(workspaceRootPath)) {
      return // Already watching this workspace
    }

    sessionLog.debug(`Setting up ConfigWatcher for workspace: ${workspaceId} (${workspaceRootPath})`)
    const resourceProjectRoot = isFreeConversationWorkspaceId(workspaceId)
      ? undefined
      : workspaceRootPath

    const callbacks: ConfigWatcherCallbacks = {
      onSourcesListChange: async () => {
        const sources = loadWorkspaceSources(resourceProjectRoot)
        sessionLog.info(`Sources list changed in ${workspaceRootPath} (${sources.length} sources)`)
        this.broadcastSourcesChanged(workspaceId, sources)
        await this.reloadSourcesForWorkspace(workspaceRootPath)
      },
      onSourceChange: async (slug: string, source: LoadedSource | null) => {
        sessionLog.info(`Source '${slug}' changed:`, source ? 'updated' : 'deleted')
        const sources = loadWorkspaceSources(resourceProjectRoot)
        this.broadcastSourcesChanged(workspaceId, sources)
        await this.reloadSourcesForWorkspace(workspaceRootPath)
      },
      onSourceGuideChange: (sourceSlug: string) => {
        sessionLog.info(`Source guide changed: ${sourceSlug}`)
        // Broadcast the updated sources list so sidebar picks up guide changes
        // Note: Guide changes don't require session source reload (no server changes)
        const sources = loadWorkspaceSources(resourceProjectRoot)
        this.broadcastSourcesChanged(workspaceId, sources)
      },
      onStatusConfigChange: () => {
        sessionLog.info(`Status config changed in ${workspaceId}`)
        this.broadcastStatusesChanged(workspaceId)
      },
      onStatusIconChange: (_workspaceId: string, iconFilename: string) => {
        sessionLog.info(`Status icon changed: ${iconFilename} in ${workspaceId}`)
        this.broadcastStatusesChanged(workspaceId)
      },
      onLabelConfigChange: () => {
        sessionLog.info(`Label config changed in ${workspaceId}`)
        this.broadcastLabelsChanged(workspaceId)
        // Emit LabelConfigChange event via AutomationSystem
        const automationSystem = this.automationSystems.get(workspaceRootPath)
        if (automationSystem) {
          automationSystem.emitLabelConfigChange().catch((error) => {
            sessionLog.error(`[Automations] Failed to emit LabelConfigChange:`, error)
          })
        }
      },
      onAutomationsConfigChange: () => {
        sessionLog.info(`Automations config changed in ${workspaceId}`)
        // Reload automations config via AutomationSystem
        const automationSystem = this.automationSystems.get(workspaceRootPath)
        if (automationSystem) {
          const result = automationSystem.reloadConfig()
          if (result.errors.length === 0) {
            sessionLog.info(`Reloaded ${result.automationCount} automations for workspace ${workspaceId}`)
          } else {
            sessionLog.error(`Failed to reload automations for workspace ${workspaceId}:`, result.errors)
          }
        }
        // Notify renderer to re-read automations.json
        this.broadcastAutomationsChanged(workspaceId)
      },
      onLlmConnectionsChange: () => {
        sessionLog.info(`LLM connections changed in ${workspaceId}`)
        this.broadcastLlmConnectionsChanged()
      },
      onAppThemeChange: (theme) => {
        sessionLog.info(`App theme changed`)
        this.broadcastAppThemeChanged(theme)
      },
      onDefaultPermissionsChange: () => {
        sessionLog.info('Default permissions changed')
        this.broadcastDefaultPermissionsChanged()
      },
      onSkillsChange: () => {
        sessionLog.info(`Skills changed in ${workspaceRootPath}`)
        this.broadcastSkillsChanged(workspaceId)
      },

      // Session metadata changes (edits to session.jsonl headers).
      // Detects changes from both internal writes (self) and external sources
      // (other instances, scripts, manual edits).
      onSessionMetadataChange: (sessionId, header) => {
        const managed = this.sessions.get(sessionId)
        if (!managed) return

        // Check if this is our own write echoing back via fs.watch().
        // Self-writes don't need in-memory sync (already up to date), but
        // still need to notify the automation system for event matching.
        const incomingSignature = getHeaderMetadataSignature(header)
        const lastWrittenSignature = sessionPersistenceQueue.getLastWrittenSignature(sessionId)
        const isSelfWrite = !!(lastWrittenSignature && incomingSignature === lastWrittenSignature)

        // For external writes: sync in-memory state + emit UI events.
        // Skip for self-writes to avoid feedback loops (especially on Windows
        // where fs.watch fires aggressively: unlink + rename = 2+ events).
        if (!isSelfWrite) {
          // Defer external metadata application when:
          // 1. Session is actively processing (agent running), OR
          // 2. Session was just written programmatically (set_session_status/labels tool)
          //    — fs.watch fires during atomic write (unlink+rename) and can read stale data
          const hasWriteGuard = managed._metadataWriteGuardUntil && Date.now() < managed._metadataWriteGuardUntil
          if (managed.isProcessing || hasWriteGuard) {
            managed.pendingExternalMetadata = header
            if (hasWriteGuard) {
              sessionLog.info(`Deferred external metadata update for session ${sessionId} (recent programmatic write)`)
            } else {
              sessionLog.info(`Deferred external metadata update for session ${sessionId} (processing active)`)
            }
          } else {
            this.applyExternalSessionMetadata(managed, header)
          }
        }

        // Always notify automation system — it does its own diffing and needs
        // to see both self-writes and external changes for event matching.
        const automationSystem = this.automationSystems.get(managed.workspace.rootPath)
        if (automationSystem) {
          automationSystem.updateSessionMetadata(sessionId, {
            permissionMode: header.permissionMode,
            labels: header.labels,
            isFlagged: header.isFlagged,
            sessionStatus: header.sessionStatus,
            sessionName: header.name,
          }).catch((error) => {
            sessionLog.error(`[Automations] Failed to update session metadata:`, error)
          })
        }
      },
    }

    const watcher = new ConfigWatcher(workspaceRootPath, callbacks)
    watcher.start()
    this.configWatchers.set(workspaceRootPath, watcher)

    // Initialize AutomationSystem for this workspace (includes scheduler, handlers, and event logging)
    if (!this.automationSystems.has(workspaceRootPath)) {
      const automationSystem = new AutomationSystem({
        workspaceRootPath,
        workspaceId,
        enableScheduler: true,
        onPromptsReady: async (prompts) => {
          // Execute prompt automations by creating new sessions
          const settled = await Promise.allSettled(
            prompts.map((pending) =>
              this.executePromptAutomation({
                workspaceId,
                workspaceRootPath,
                prompt: pending.prompt,
                labels: pending.labels,
                permissionMode: pending.permissionMode,
                mentions: pending.mentions,
                llmConnection: pending.llmConnection,
                model: pending.model,
                thinkingLevel: pending.thinkingLevel,
                automationName: pending.automationName,
                telegramTopic: pending.telegramTopic,
              })
            )
          )

          // Write enriched history entries (with session IDs and prompt summaries)
          for (const [idx, result] of settled.entries()) {
            const pending = prompts[idx]
            if (!pending.matcherId) continue

            const entry = createPromptHistoryEntry({
              matcherId: pending.matcherId,
              ok: result.status === 'fulfilled',
              sessionId: result.status === 'fulfilled' ? result.value.sessionId : undefined,
              prompt: pending.prompt,
              error: result.status === 'rejected' ? String(result.reason) : undefined,
            })

            appendAutomationHistoryEntry(workspaceRootPath, entry).catch(e => sessionLog.warn('[Automations] Failed to write history:', e))

            if (result.status === 'rejected') {
              sessionLog.error(`[Automations] Failed to execute prompt action ${idx + 1}:`, result.reason)
            } else {
              sessionLog.info(`[Automations] Created session ${result.value.sessionId} from prompt action`)
            }
          }
        },
        onError: (event, error) => {
          sessionLog.error(`Automation failed for ${event}:`, error.message)
        },
      })
      this.automationSystems.set(workspaceRootPath, automationSystem)
      sessionLog.debug(`Initialized AutomationSystem for workspace ${workspaceId}`)
    }
  }

  /**
   * Manually notify the ConfigWatcher of a file change.
   * Workaround for Bun's fs.watch on Linux not detecting atomic renames.
   */
  notifyConfigFileChange(workspaceRootPath: string, relativePath: string): void {
    const watcher = this.configWatchers.get(workspaceRootPath)
    watcher?.notifyFileChange(relativePath)
  }

  /**
   * Reload sources for all sessions in a workspace, skipping those currently processing.
   */
  private async reloadSourcesForWorkspace(workspaceRootPath: string): Promise<void> {
    for (const [_, managed] of this.sessions) {
      if (managed.workspace.rootPath === workspaceRootPath) {
        if (managed.isProcessing) {
          sessionLog.info(`Skipping source reload for session ${managed.id} (processing)`)
          continue
        }
        await this.reloadSessionSources(managed)
      }
    }
  }

  private broadcastSourcesChanged(workspaceId: string, sources: LoadedSource[]): void {
    if (!this.eventSink) return
    this.eventSink(RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId }, workspaceId, sources)
  }

  private broadcastStatusesChanged(workspaceId: string): void {
    if (!this.eventSink) return
    sessionLog.info(`Broadcasting statuses changed for ${workspaceId}`)
    this.eventSink(RPC_CHANNELS.statuses.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
  }

  private broadcastLabelsChanged(workspaceId: string): void {
    if (!this.eventSink) return
    sessionLog.info(`Broadcasting labels changed for ${workspaceId}`)
    this.eventSink(RPC_CHANNELS.labels.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
  }

  private broadcastAutomationsChanged(workspaceId: string): void {
    if (!this.eventSink) return
    sessionLog.info(`Broadcasting automations changed for ${workspaceId}`)
    this.eventSink(RPC_CHANNELS.automations.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
  }

  private broadcastAppThemeChanged(theme: import('@craft-agent/shared/config').ThemeOverrides | null): void {
    this.broadcastGlobalOnce(RPC_CHANNELS.theme.APP_CHANGED, () => {
      sessionLog.info(`Broadcasting app theme changed`)
      this.eventSink?.(RPC_CHANNELS.theme.APP_CHANGED, { to: 'all' }, theme)
    })
  }

  private broadcastLlmConnectionsChanged(): void {
    this.broadcastGlobalOnce(RPC_CHANNELS.llmConnections.CHANGED, () => {
      sessionLog.info('Broadcasting LLM connections changed')
      this.eventSink?.(RPC_CHANNELS.llmConnections.CHANGED, { to: 'all' })
    })
  }

  private broadcastSkillsChanged(workspaceId: string): void {
    if (!this.eventSink) return
    sessionLog.info('Broadcasting skills changed')
    this.eventSink(RPC_CHANNELS.skills.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
  }

  private broadcastDefaultPermissionsChanged(): void {
    this.broadcastGlobalOnce(RPC_CHANNELS.permissions.DEFAULTS_CHANGED, () => {
      sessionLog.info('Broadcasting default permissions changed')
      this.eventSink?.(RPC_CHANNELS.permissions.DEFAULTS_CHANGED, { to: 'all' }, null)
    })
  }

  /**
   * Reload sources for a session with an active agent.
   * Called by ConfigWatcher when source files change on disk.
   * If agent is null (session hasn't sent any messages), skip - fresh build happens on next message.
   */
  private async reloadSessionSources(managed: ManagedSession): Promise<void> {
    await this.withAgentRuntimeLock(managed, async () => {
      const agent = managed.agent
      if (!agent) return  // No agent = nothing to update (fresh build on next message)

      const workspaceRootPath = managed.workspace.rootPath
      const projectRoot = getResourceProjectRoot(managed.workspace)
      sessionLog.info(`Reloading sources for session ${managed.id}`)

      // Reload all sources from disk (craft-agents-docs is always available as MCP server)
      const allSources = loadAllSources(projectRoot)
      agent.setAllSources(allSources)

      // Rebuild MCP and API servers for session's enabled sources
      const enabledSlugs = managed.enabledSourceSlugs || []
      const enabledSources = allSources.filter(s =>
        enabledSlugs.includes(s.config.slug) && isSourceUsable(s)
      )
      // Pass session path so large API responses can be saved to session folder
      const sessionPath = getSessionStoragePath(workspaceRootPath, managed.id)
      const { mcpServers, apiServers } = await buildServersFromSources(enabledSources, sessionPath, managed.tokenRefreshManager, agent.getSummarizeCallback())
      const intendedSlugs = enabledSources.map(s => s.config.slug)

      // Update source runtime config/credentials for backends that need it
      await applyBridgeUpdates(agent, sessionPath, enabledSources, mcpServers, managed.id, workspaceRootPath, 'source reload')
      await agent.setSourceServers(mcpServers, apiServers, intendedSlugs)

      sessionLog.info(`Sources reloaded for session ${managed.id}: ${Object.keys(mcpServers).length} MCP, ${Object.keys(apiServers).length} API`)
    })
  }

  /**
   * Reinitialize authentication environment variables.
   * Call this after onboarding or settings changes to pick up new credentials.
   *
   * SECURITY NOTE: These env vars are propagated to the SDK subprocess via options.ts.
   * Bun's automatic .env loading is disabled in the subprocess (--env-file=/dev/null)
   * to prevent a user's project .env from injecting ANTHROPIC_API_KEY and overriding
   * OAuth auth — Claude Code prioritizes API key over OAuth token when both are set.
   * See: https://github.com/lukilabs/craft-agents-oss/issues/39
   */
  /**
   * Reinitialize authentication environment variables.
   *
   * Uses the default LLM connection to determine which credentials to set.
   *
   * @param connectionSlug - Optional connection slug to use (overrides default)
   */
  async reinitializeAuth(connectionSlug?: string): Promise<void> {
    try {
      const manager = getCredentialManager()

      // Get the connection to use (explicit parameter or default)
      const slug = connectionSlug || getDefaultLlmConnection()
      if (!slug) {
        sessionLog.warn('No LLM connection slug available for reinitializeAuth')
      }
      const connection = slug ? getLlmConnection(slug) : null

      // Restore managed auth env vars to their baseline before applying this connection.
      resetManagedAnthropicAuthEnvVars()

      if (!connection) {
        sessionLog.error(`No LLM connection found for slug: ${slug}`)
        return
      }

      sessionLog.info(`Reinitializing auth for connection: ${slug} (${connection.authType})`)

      // Resolve auth env vars via shared utility (provider-agnostic)
      const result = await resolveAuthEnvVars(connection, slug!, manager)

      if (!result.success) {
        sessionLog.error(`Auth resolution failed for ${slug}: ${result.warning}`)
      } else {
        // Apply resolved env vars to process.env
        for (const [key, value] of Object.entries(result.envVars)) {
          process.env[key] = value
        }
        sessionLog.info(`Auth env vars set for connection: ${slug}`)
      }
    } catch (error) {
      sessionLog.error('Failed to reinitialize auth:', error)
      throw error
    }
  }

  async initialize(): Promise<void> {
    try {
      // Backfill missing `models` arrays on existing LLM connections
      migrateLegacyLlmConnectionsConfig()

      // Fix defaultLlmConnection if it points to a non-existent connection
      migrateOrphanedDefaultConnections()

      // Sync distribution-provided connection metadata after legacy migration.
      // Managed credentials are projected separately from client auth sessions.
      await seedBuiltinLlmConnectionFromDefaults()

      // Migrate legacy credentials to LLM connection format (one-time migration)
      // This ensures credentials saved before LLM connections are available via the new system
      await migrateLegacyCredentials()

      // Set up authentication environment variables (critical for SDK to work)
      await this.reinitializeAuth()

      // Eagerly activate ConfigWatcher + AutomationSystem for every workspace so
      // the scheduler and event handlers start at boot — not lazily on first
      // client connect. This is critical for headless servers where no UI may
      // ever connect, yet scheduled/event-driven automations must still fire.
      const workspaces = getWorkspaces()
      for (const workspace of workspaces) {
        this.setupConfigWatcher(workspace.rootPath, workspace.id)
      }
      sessionLog.info('Initialized workspace runtime services', { workspaceCount: workspaces.length })

      // Load existing sessions from disk
      await this.loadSessionsFromDisk()

      // Signal that initialization is complete — IPC handlers waiting on initGate will proceed
      this.initGate.markReady()
    } catch (error) {
      this.initGate.markFailed(error)
      throw error
    }
  }

  // Load all existing sessions from disk into memory (metadata only - messages are lazy-loaded)
  private async loadSessionsFromDisk(): Promise<void> {
    try {
      const workspaces = orderWorkspacesByActiveFirst(
        listSessionWorkspaces(),
        getActiveWorkspace()?.id,
      )
      let totalSessions = 0
      let sessionsSinceYield = 0
      const permissionModeCounts: Record<PermissionMode, number> = {
        safe: 0,
        ask: 0,
        'allow-all': 0,
      }

      // Iterate over each workspace and load its sessions
      for (const workspace of workspaces) {
        const workspaceRootPath = workspace.rootPath
        const sessionMetadata = await listStoredSessions(workspaceRootPath)
        // Load workspace config once per workspace for default working directory
        const wsConfig = loadWorkspaceConfig(workspaceRootPath)
        const wsDefaultWorkingDir = wsConfig?.defaults?.workingDirectory

        for (const meta of sessionMetadata) {
          // Create managed session from metadata only (messages lazy-loaded on demand)
          // This dramatically reduces memory usage at startup - messages are loaded
          // when getSession() is called for a specific session
          const managed = createManagedSession(meta, workspace, {
            enabledSourceSlugs: undefined,  // Loaded with messages
            workingDirectory: meta.workingDirectory ?? wsDefaultWorkingDir,
          })

          // Migration: clear orphaned llmConnection references (e.g., after connection was deleted)
          if (managed.llmConnection) {
            const conn = resolveSessionConnection(managed.llmConnection, undefined)
            if (!conn) {
              sessionLog.warn(`Session ${meta.id} has orphaned llmConnection "${managed.llmConnection}", clearing`)
              managed.llmConnection = undefined
              managed.connectionLocked = false
            }
          }

          // Initialize mode-manager state for restored sessions even before agent creation.
          // This keeps diagnostics/effective mode aligned with persisted session metadata.
          const restoredPermissionMode = managed.permissionMode ?? 'ask'
          setPermissionMode(meta.id, restoredPermissionMode, { changedBy: 'restore' })
          permissionModeCounts[restoredPermissionMode]++
          if (managed.previousPermissionMode) {
            hydratePreviousPermissionMode(meta.id, managed.previousPermissionMode)
          }

          this.sessions.set(meta.id, managed)

          // Initialize session metadata in AutomationSystem for diffing
          const automationSystem = this.automationSystems.get(workspaceRootPath)
          if (automationSystem) {
            automationSystem.setInitialSessionMetadata(meta.id, {
              permissionMode: meta.permissionMode,
              labels: meta.labels,
              isFlagged: meta.isFlagged,
              sessionStatus: meta.sessionStatus,
              sessionName: managed.name,
            })
          }

          totalSessions++
          sessionsSinceYield++
          if (sessionsSinceYield >= 100) {
            sessionsSinceYield = 0
            await new Promise<void>((resolve) => setImmediate(resolve))
          }
        }

        // ADR 0013: open this workspace's gate as soon as its sessions are indexed,
        // so entering one project never waits on other projects' histories.
        this.initGate.markScopeReady(workspace.id)

        // listStoredSessions() is synchronous per workspace. Yield between
        // roots so workspace/file RPCs remain responsive during restoration.
        await new Promise<void>((resolve) => setImmediate(resolve))
      }

      sessionLog.info(`Loaded ${totalSessions} sessions from disk (metadata only)`, {
        permissionModes: permissionModeCounts,
      })
    } catch (error) {
      sessionLog.error('Failed to load sessions from disk:', error)
    }
  }

  // Suppress fs.watch metadata-revert events for the window in which our own
  // atomic write completes. See onSessionMetadataChange.
  private setMetadataWriteGuard(managed: ManagedSession): void {
    managed._metadataWriteGuardUntil = Date.now() + METADATA_WRITE_GUARD_MS
  }

  /**
   * Persist a session to disk (async, with debouncing in the persistence queue).
   *
   * Cold-session path: if messages haven't been lazy-loaded yet, hydrate them
   * synchronously from the JSONL first — otherwise the snapshot we enqueue
   * would write `messages: []` over the real messages on disk. Hydration
   * deliberately does NOT touch persistent metadata fields (name, labels,
   * sessionStatus, llmConnection, ...) because the caller may have just
   * mutated them; the in-memory mutation must win over what's on disk.
   * `loadStoredSession` is synchronous (sync fs reads), so the entire path
   * stays sync — no microtask race window between the load and the enqueue.
   */
  private persistSession(managed: ManagedSession): void {
    if (this.sessions.get(managed.id) !== managed) return
    if (!managed.messagesLoaded) {
      this.hydrateMessagesForColdPersist(managed)
    }
    this.enqueuePersist(managed)
  }

  // Cold-persist hydration. Mirrors the messages/queue-recovery half of
  // loadMessagesFromDisk but skips the metadata field syncs. Sets
  // messagesLoaded=true so subsequent persistSession calls take the fast path.
  // Subsequent ensureMessagesLoaded calls also short-circuit, which is fine —
  // queue recovery has already run here.
  private hydrateMessagesForColdPersist(managed: ManagedSession): void {
    sessionLog.debug(`Cold-load triggered for persistSession on ${managed.id}`)
    const stored = loadStoredSession(managed.workspace.rootPath, managed.id)
    if (stored) {
      managed.messages = (stored.messages || []).map(storedToMessage)
      managed.tokenUsage = stored.tokenUsage
      // Deferred-load fields (intentionally undefined after startup, see
      // loadSessionsFromDisk). Populate from disk only if not already set in
      // memory — a caller may have mutated them via setSessionSources etc.
      if (managed.enabledSourceSlugs === undefined) managed.enabledSourceSlugs = stored.enabledSourceSlugs
      if (managed.lastReadMessageId === undefined) managed.lastReadMessageId = stored.lastReadMessageId
      if (managed.hasUnread === undefined) managed.hasUnread = stored.hasUnread
      if (managed.sharedUrl === undefined) managed.sharedUrl = stored.sharedUrl
      if (managed.sharedId === undefined) managed.sharedId = stored.sharedId
      if (managed.transferredSessionSummary === undefined) managed.transferredSessionSummary = stored.transferredSessionSummary
      if (managed.transferredSessionSummaryApplied === undefined) managed.transferredSessionSummaryApplied = stored.transferredSessionSummaryApplied

      // Queue recovery: find orphaned queued messages from crash/restart and re-queue them.
      const orphanedQueued = managed.messages.filter(m =>
        m.role === 'user' && m.isQueued === true
      )
      if (orphanedQueued.length > 0) {
        sessionLog.info(`Recovering ${orphanedQueued.length} queued message(s) for session ${managed.id}`)
        for (const msg of orphanedQueued) {
          managed.messageQueue.push({
            message: msg.content,
            messageId: msg.id,
            attachments: undefined,
            storedAttachments: msg.attachments,
            options: msg.queuedWorkspaceFreshnessContext
              ? { workspaceFreshnessContext: msg.queuedWorkspaceFreshnessContext }
              : undefined,
          })
        }
        if (!managed.isProcessing && managed.messageQueue.length > 0) {
          setImmediate(() => {
            this.processNextQueuedMessage(managed.id)
          })
        }
      }
      sessionLog.debug(`Cold-hydrated ${managed.messages.length} messages for session ${managed.id}`)
    }
    managed.messagesLoaded = true
  }

  // Build the StoredSession snapshot and hand it to the persistence queue.
  // Caller must ensure `managed.messagesLoaded` is true.
  private enqueuePersist(managed: ManagedSession): void {
    try {
      this.enqueuePersistStrict(managed)
    } catch (error) {
      sessionLog.error(`Failed to queue session ${managed.id} for persistence:`, error)
    }
  }

  private enqueuePersistStrict(managed: ManagedSession): void {
    const persistableMessages = managed.messages.filter(m => m.role !== 'status')
    const storedSession: StoredSession = {
      ...pickSessionFields(managed),
      workspaceRootPath: managed.workspace.rootPath,
      createdAt: managed.createdAt ?? Date.now(),
      lastUsedAt: Date.now(),
      messages: persistableMessages.map(messageToStored),
      tokenUsage: managed.tokenUsage ?? DEFAULT_TOKEN_USAGE,
    } as StoredSession
    sessionPersistenceQueue.enqueue(storedSession)
  }

  // Flush a specific session immediately (call on session close/switch).
  // Cold-persist hydration is synchronous, so by the time we reach here the
  // queue already has an entry whenever persistSession was just called.
  async flushSession(sessionId: string): Promise<void> {
    await sessionPersistenceQueue.flush(sessionId)
  }

  // Flush all pending sessions (call on app quit).
  async flushAllSessions(): Promise<void> {
    await sessionPersistenceQueue.flushAll()
  }

  private accumulateTurnUsage(managed: ManagedSession, usage?: TurnUsage): void {
    if (!usage) return
    managed.tokenUsage ??= {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      costUsd: 0,
    }
    managed.tokenUsage.inputTokens += usage.inputTokens
    managed.tokenUsage.outputTokens += usage.outputTokens
    managed.tokenUsage.totalTokens = managed.tokenUsage.inputTokens + managed.tokenUsage.outputTokens
    managed.tokenUsage.costUsd += usage.costUsd ?? 0
    managed.tokenUsage.cacheReadTokens = (managed.tokenUsage.cacheReadTokens ?? 0) + (usage.cacheReadTokens ?? 0)
    managed.tokenUsage.cacheCreationTokens = (managed.tokenUsage.cacheCreationTokens ?? 0) + (usage.cacheCreationTokens ?? 0)
    if (usage.contextTokens !== undefined) managed.tokenUsage.contextTokens = usage.contextTokens
    if (usage.contextWindow) managed.tokenUsage.contextWindow = usage.contextWindow
  }

  private attachTurnMetrics(managed: ManagedSession, message: Message, usage?: TurnUsage): TurnMetrics {
    const metrics: TurnMetrics = {
      durationMs: Math.max(0, Date.now() - (managed.turnStartedAt ?? message.timestamp)),
      ...(usage && { usage }),
    }
    message.turnMetrics = metrics
    managed.pendingTurnMetrics ??= new Map()
    managed.pendingTurnMetrics.set(message.id, metrics)
    return metrics
  }

  private async handlePlanSubmitted(managed: ManagedSession, planPath: string): Promise<void> {
    sessionLog.info(`Plan submitted for session ${managed.id}:`, planPath)
    try {
      const planContent = await readFile(planPath, 'utf-8')

      const submitPlanMsg = managed.messages.find(
        m => m.toolName?.includes('SubmitPlan') && m.toolStatus === 'executing'
      )
      if (submitPlanMsg) {
        submitPlanMsg.toolStatus = 'completed'
        submitPlanMsg.content = 'Plan submitted for review'
        submitPlanMsg.toolResult = 'Plan submitted for review'
      }

      const planMessage: Message = {
        id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'plan' as const,
        content: planContent,
        timestamp: this.monotonic(),
        planPath,
      }

      managed.messages.push(planMessage)
      managed.lastMessageRole = 'plan'
      const turnUsage = managed.agent?.getCurrentTurnUsage()
      this.accumulateTurnUsage(managed, turnUsage)
      this.attachTurnMetrics(managed, planMessage, turnUsage)

      this.persistSession(managed)
      await this.flushSession(managed.id)

      this.sendEvent({
        type: 'plan_submitted',
        sessionId: managed.id,
        message: planMessage,
      }, managed.workspace.id)

      if (managed.isProcessing && managed.agent) {
        sessionLog.info(`Interrupting for plan submission in session ${managed.id}`)
        managed.agent.interruptForHandoff(AbortReason.PlanSubmitted)
        this.setProcessing(managed, false)

        await releaseBrowserOwnershipOnForcedStop(this.browserPaneManager, managed.id)

        this.sendEvent({
          type: 'complete',
          sessionId: managed.id,
          tokenUsage: managed.tokenUsage,
          turnMetrics: managed.pendingTurnMetrics
            ? Array.from(managed.pendingTurnMetrics, ([messageId, metrics]) => ({ messageId, metrics }))
            : undefined,
        }, managed.workspace.id)
        managed.pendingTurnMetrics = undefined
      }
    } catch (error) {
      sessionLog.error(`Failed to read plan file:`, error)
    }
  }

  // ============================================
  // Unified Auth Request Helpers
  // ============================================

  /**
   * Get human-readable description for auth request
   */
  private getAuthRequestDescription(request: AuthRequest): string {
    switch (request.type) {
      case 'credential':
        return `Authentication required for ${request.sourceName}`
      case 'oauth':
        return `OAuth authentication for ${request.sourceName}`
      case 'oauth-google':
        return `Sign in with Google for ${request.sourceName}`
      case 'oauth-slack':
        return `Sign in with Slack for ${request.sourceName}`
      case 'oauth-microsoft':
        return `Sign in with Microsoft for ${request.sourceName}`
    }
  }

  /**
   * Format auth result message to send back to agent
   */
  private formatAuthResultMessage(result: AuthResult): string {
    if (result.success) {
      let msg = `Authentication completed for ${result.sourceSlug}.`
      if (result.email) msg += ` Signed in as ${result.email}.`
      if (result.workspace) msg += ` Connected to workspace: ${result.workspace}.`
      msg += ' Credentials have been saved.'
      return msg
    }
    if (result.cancelled) {
      return `Authentication cancelled for ${result.sourceSlug}.`
    }
    return `Authentication failed for ${result.sourceSlug}: ${result.error || 'Unknown error'}`
  }


  /**
   * Complete an auth request and send result back to agent
   * This updates the auth message status and sends a faked user message
   */
  async completeAuthRequest(sessionId: string, result: AuthResult): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      sessionLog.warn(`Cannot complete auth request - session ${sessionId} not found`)
      return
    }

    // Find and update the pending auth-request message
    const authMessage = managed.messages.find(m =>
      m.role === 'auth-request' &&
      m.authRequestId === result.requestId &&
      m.authStatus === 'pending'
    )

    if (authMessage) {
      authMessage.authStatus = result.success ? 'completed' :
                               result.cancelled ? 'cancelled' : 'failed'
      authMessage.authError = result.error
      authMessage.authEmail = result.email
      authMessage.authWorkspace = result.workspace
    }

    // Emit auth_completed event to update UI
    this.sendEvent({
      type: 'auth_completed',
      sessionId,
      requestId: result.requestId,
      success: result.success,
      cancelled: result.cancelled,
      error: result.error,
    }, managed.workspace.id)

    // Create faked user message with result
    const resultContent = this.formatAuthResultMessage(result)

    // Clear pending auth state
    managed.pendingAuthRequestId = undefined
    managed.pendingAuthRequest = undefined

    // Auto-enable the source in the session after successful auth
    if (result.success && result.sourceSlug) {
      const slugSet = new Set(managed.enabledSourceSlugs || [])
      if (!slugSet.has(result.sourceSlug)) {
        slugSet.add(result.sourceSlug)
        managed.enabledSourceSlugs = Array.from(slugSet)
        sessionLog.info(`Auto-enabled source ${result.sourceSlug} in session ${sessionId} after auth`)
      }

      // Clear any refresh cooldown so the source is immediately usable
      managed.tokenRefreshManager.clearCooldown(result.sourceSlug)
    }

    // Persist session with updated auth message and enabled sources
    this.persistSession(managed)

    // Update source runtime config/credentials for backends that need it
    if (result.success && result.sourceSlug) {
      const workspaceRootPath = managed.workspace.rootPath
      const sessionPath = getSessionStoragePath(workspaceRootPath, managed.id)
      const enabledSlugs = managed.enabledSourceSlugs || []
      const allSources = loadAllSources(getResourceProjectRoot(managed.workspace))
      const enabledSources = allSources.filter(s =>
        enabledSlugs.includes(s.config.slug) && isSourceUsable(s)
      )
      const { mcpServers } = await buildServersFromSources(
        enabledSources, sessionPath, managed.tokenRefreshManager
      )
      await this.withAgentRuntimeLock(managed, async () => {
        if (!managed.agent) return
        await applyBridgeUpdates(managed.agent, sessionPath, enabledSources, mcpServers, managed.id, workspaceRootPath, 'source auth')
      })
    }

    // Send the result as a new message to resume conversation
    // Use empty arrays for attachments since this is a system-generated message
    await this.sendMessage(sessionId, resultContent, [], [], {})

    sessionLog.info(`Auth request completed for ${result.sourceSlug}: ${result.success ? 'success' : 'failed'}`)
  }

  /**
   * Handle credential input from the UI (for non-OAuth auth)
   * Called when user submits credentials via the inline form
   */
  async handleCredentialInput(
    sessionId: string,
    requestId: string,
    response: import('@craft-agent/shared/protocol').CredentialResponse
  ): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed?.pendingAuthRequest) {
      sessionLog.warn(`Cannot handle credential input - no pending auth request for session ${sessionId}`)
      return
    }

    const request = managed.pendingAuthRequest as CredentialAuthRequest
    if (request.requestId !== requestId) {
      sessionLog.warn(`Credential request ID mismatch: expected ${request.requestId}, got ${requestId}`)
      return
    }

    if (response.cancelled) {
      await this.completeAuthRequest(sessionId, {
        requestId,
        sourceSlug: request.sourceSlug,
        success: false,
        cancelled: true,
      })
      return
    }

    try {
      // Store credentials using existing workspace ID extraction pattern
      const credManager = getCredentialManager()
      // Extract workspace ID from root path (last segment of path)
      const wsId = basename(managed.workspace.rootPath) || managed.workspace.id

      if (request.mode === 'basic') {
        // Store value as JSON string {username, password} - credential-manager.ts parses it for basic auth
        await credManager.set(
          { type: 'source_basic', workspaceId: wsId, sourceId: request.sourceSlug },
          { value: JSON.stringify({ username: response.username, password: response.password }) }
        )
      } else if (request.mode === 'bearer') {
        await credManager.set(
          { type: 'source_bearer', workspaceId: wsId, sourceId: request.sourceSlug },
          { value: response.value! }
        )
      } else if (request.mode === 'multi-header') {
        // Store multi-header credentials as JSON { "DD-API-KEY": "...", "DD-APPLICATION-KEY": "..." }
        await credManager.set(
          { type: 'source_apikey', workspaceId: wsId, sourceId: request.sourceSlug },
          { value: JSON.stringify(response.headers) }
        )
      } else {
        // header or query - both use API key storage
        await credManager.set(
          { type: 'source_apikey', workspaceId: wsId, sourceId: request.sourceSlug },
          { value: response.value! }
        )
      }

      // Update source config to mark as authenticated
      const { markSourceAuthenticated } = await import('@craft-agent/shared/sources')
      markSourceAuthenticated(managed.workspace.rootPath, request.sourceSlug)

      // Mark source as unseen so fresh guide is injected on next message
      if (managed.agent) {
        managed.agent.markSourceUnseen(request.sourceSlug)
      }

      await this.completeAuthRequest(sessionId, {
        requestId,
        sourceSlug: request.sourceSlug,
        success: true,
      })
    } catch (error) {
      sessionLog.error(`Failed to save credentials for ${request.sourceSlug}:`, error)
      await this.completeAuthRequest(sessionId, {
        requestId,
        sourceSlug: request.sourceSlug,
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save credentials',
      })
    }
  }

  getWorkspaces(): Workspace[] {
    return getWorkspaces()
  }

  getWorkspacesInfo(): WorkspaceInfo[] {
    return getWorkspaces().map(({ rootPath, createdAt, ...info }) => info)
  }

  getActiveSessionCount(workspaceId?: string): number {
    let count = 0
    for (const managed of this.sessions.values()) {
      if (workspaceId && managed.workspace.id !== workspaceId) continue
      if (managed.isProcessing) count++
    }
    return count
  }

  getWorkspaceAutomationSummary(workspaceId: string): { automationCount: number; schedulerRunning: boolean } {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return { automationCount: 0, schedulerRunning: false }

    const automationSystem = this.automationSystems.get(workspace.rootPath)
    if (!automationSystem) return { automationCount: 0, schedulerRunning: false }

    const config = automationSystem.getConfig()
    let automationCount = 0
    if (config) {
      for (const matchers of Object.values(config.automations)) {
        automationCount += matchers?.length ?? 0
      }
    }

    return {
      automationCount,
      schedulerRunning: automationSystem.isSchedulerRunning(),
    }
  }

  getActiveSessionsInfo(): ActiveSessionInfo[] {
    const result: ActiveSessionInfo[] = []
    for (const managed of this.sessions.values()) {
      if (!managed.isProcessing) continue

      let status: SessionProcessingStatus = 'processing'
      if (managed.stopRequested) status = 'idle'

      result.push({
        sessionId: managed.id,
        workspaceId: managed.workspace.id,
        workspaceName: managed.workspace.name,
        title: managed.name || undefined,
        status,
        triggeredBy: managed.triggeredBy
          ? { automationName: managed.triggeredBy.automationName ?? 'Unknown', timestamp: managed.triggeredBy.timestamp ?? 0 }
          : undefined,
        createdAt: managed.lastMessageAt,
      })
    }
    return result
  }

  /**
   * Reload all sessions from disk.
   * Used after importing sessions to refresh the in-memory session list.
   */
  reloadSessions(): void {
    this.loadSessionsFromDisk()
  }

  getSessions(workspaceId?: string): Session[] {
    // Returns session metadata only - messages are NOT included to save memory
    // Use getSession(id) to load messages for a specific session
    let sessions = Array.from(this.sessions.values())

    // Filter by workspace if specified (used when switching workspaces)
    if (workspaceId) {
      sessions = sessions.filter(m => m.workspace.id === workspaceId)
    }

    return sessions
      .map(m => managedToSession(m))
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
  }

  /**
   * Aggregate unread state across all workspaces.
   * Excludes hidden and archived sessions from counts/indicators.
   */
  getUnreadSummary(): UnreadSummary {
    const byWorkspace: Record<string, number> = {}
    const hasUnreadByWorkspace: Record<string, boolean> = {}

    for (const workspace of listSessionWorkspaces()) {
      byWorkspace[workspace.id] = 0
      hasUnreadByWorkspace[workspace.id] = false
    }

    for (const session of this.sessions.values()) {
      if (session.hidden || session.isArchived) continue
      if (!session.hasUnread) continue

      const workspaceId = session.workspace.id
      byWorkspace[workspaceId] = (byWorkspace[workspaceId] ?? 0) + 1
      hasUnreadByWorkspace[workspaceId] = true
    }

    const totalUnreadSessions = Object.values(byWorkspace).reduce((sum, count) => sum + count, 0)

    return {
      totalUnreadSessions,
      byWorkspace,
      hasUnreadByWorkspace,
    }
  }

  /**
   * Refresh badge count from current unread state.
   * Called by renderer on mount — ensures badge is set even if the initial
   * emitUnreadSummaryChanged() fired before the renderer was ready.
   */
  refreshBadge(): void {
    const summary = this.getUnreadSummary()
    sessionRuntimeHooks.updateBadgeCount(summary.totalUnreadSessions)
  }

  /**
   * Broadcast global unread summary to all workspace windows.
   */
  private emitUnreadSummaryChanged(): void {
    const summary = this.getUnreadSummary()

    // Update badge via runtime hook — host decides whether/how to render badges
    sessionRuntimeHooks.updateBadgeCount(summary.totalUnreadSessions)

    if (!this.eventSink) return

    // Broadcast to renderers for UI updates (session list dots, etc.)
    this.eventSink(RPC_CHANNELS.sessions.UNREAD_SUMMARY_CHANGED, { to: 'all' }, summary)
  }

  /**
   * Get a single session by ID with all messages loaded.
   * Used for lazy loading session messages when session is selected.
   * Messages are loaded from disk on first access to reduce memory usage.
   */
  async getSession(sessionId: string): Promise<Session | null> {
    const getSessionSpan = perf.span('session.getSession', { sessionId })
    const m = this.sessions.get(sessionId)
    if (!m) {
      getSessionSpan.setMetadata('status', 'not_found')
      getSessionSpan.end()
      return null
    }

    try {
      // Lazy-load messages from disk if not yet loaded
      await this.ensureMessagesLoaded(m)
      getSessionSpan.mark('messages.loaded')
      getSessionSpan.setMetadata('messageCount', m.messages.length)

      await this.applyMessageBranchabilityMetadata(m)
      getSessionSpan.mark('branchability.applied')

      const session = managedToSession(m, { messages: m.messages })
      getSessionSpan.mark('session.serialized')
      getSessionSpan.setMetadata('status', 'ok')
      return session
    } finally {
      getSessionSpan.end()
    }
  }

  /**
   * Ensure messages are loaded for a managed session.
   * Uses promise deduplication to prevent race conditions when multiple
   * concurrent calls (e.g., rapid session switches + message send) try
   * to load messages simultaneously.
   */
  private async ensureMessagesLoaded(managed: ManagedSession): Promise<void> {
    if (managed.messagesLoaded) return

    // Deduplicate concurrent loads - return existing promise if already loading
    const existingPromise = this.messageLoadingPromises.get(managed.id)
    if (existingPromise) {
      return existingPromise
    }

    const loadPromise = this.loadMessagesFromDisk(managed)
    this.messageLoadingPromises.set(managed.id, loadPromise)

    try {
      await loadPromise
    } finally {
      this.messageLoadingPromises.delete(managed.id)
    }
  }

  /**
   * Drop an idle session's in-memory transcript so main-process heap tracks the
   * same working-set idea as the renderer (open pins + small recency buffer).
   *
   * Safety:
   * - never touches processing / queued sessions
   * - flushes pending debounced persists first so disk is not later overwritten
   *   from a cleared in-memory array via cold hydrate races
   * - next getSession/sendMessage re-hydrates via ensureMessagesLoaded
   */
  async releaseIdleSessionMessages(sessionId: string): Promise<boolean> {
    const managed = this.sessions.get(sessionId)
    if (!managed) return false
    if (!managed.messagesLoaded) return true
    if (managed.isProcessing) return false
    if (managed.messageQueue.length > 0) return false
    if (managed.agent?.isProcessing?.()) return false
    if (this.messageLoadingPromises.has(sessionId)) return false

    // Ensure any debounced snapshot is on disk before dropping memory.
    await this.flushSession(sessionId)

    // Re-check after await — a send may have started while we flushed.
    if (managed.isProcessing || managed.messageQueue.length > 0) return false
    if (managed.agent?.isProcessing?.()) return false
    if (!managed.messagesLoaded) return true

    const dropped = managed.messages.length
    managed.messages = []
    managed.messagesLoaded = false
    this.messageLoadingPromises.delete(sessionId)
    sessionLog.debug(`Released ${dropped} in-memory messages for idle session ${sessionId}`)
    return true
  }

  /**
   * Enrich loaded runtime messages with branchability derived from provider sidecars.
   * This metadata is intentionally not persisted in session.jsonl; the sidecar remains
   * the source of truth for provider-native fork anchors.
   */
  private async applyMessageBranchabilityMetadata(managed: ManagedSession): Promise<void> {
    const supportsBranching = resolveSupportsBranching(managed)

    if (!supportsBranching) {
      for (const message of managed.messages) {
        if (message.role !== 'assistant' || message.isIntermediate) {
          delete message.canBranch
          continue
        }
        message.canBranch = false
      }
      return
    }

    // canBranch is persisted as a UI hint when assistant turns complete. Use it
    // for the read path so opening a session does not block on provider sidecars;
    // branch creation still validates sidecar anchors before forking.
    if (hasPersistedAssistantBranchability(managed.messages)) {
      return
    }

    const sessionPath = getSessionStoragePath(managed.workspace.rootPath, managed.id)
    const piAnchors = await loadPiTurnAnchors(sessionPath)

    for (const message of managed.messages) {
      if (message.role !== 'assistant' || message.isIntermediate) {
        delete message.canBranch
        continue
      }

      if (!message.turnId) {
        message.canBranch = false
        continue
      }

      message.canBranch = !!piAnchors.anchors[message.id]
    }
  }

  /**
   * Internal: Load messages from disk storage into the managed session.
   */
  private async loadMessagesFromDisk(managed: ManagedSession): Promise<void> {
    const storedSession = loadStoredSession(managed.workspace.rootPath, managed.id)
    if (storedSession) {
      managed.messages = (storedSession.messages || []).map(storedToMessage)
      managed.tokenUsage = storedSession.tokenUsage
      managed.lastReadMessageId = storedSession.lastReadMessageId
      managed.hasUnread = storedSession.hasUnread  // Explicit unread flag for NEW badge state machine
      managed.enabledSourceSlugs = storedSession.enabledSourceSlugs
      managed.sharedUrl = storedSession.sharedUrl
      managed.sharedId = storedSession.sharedId
      // Sync name from disk - ensures title persistence across lazy loading
      managed.name = storedSession.name
      // Restore LLM connection state - ensures correct provider on resume
      if (storedSession.llmConnection) {
        managed.llmConnection = normalizeLlmConnectionSlug(storedSession.llmConnection)
      }
      if (storedSession.connectionLocked) {
        managed.connectionLocked = storedSession.connectionLocked
      }
      // Sync transferred session summary state from disk
      managed.transferredSessionSummary = storedSession.transferredSessionSummary
      managed.transferredSessionSummaryApplied = storedSession.transferredSessionSummaryApplied
      sessionLog.debug(`Lazy-loaded ${managed.messages.length} messages for session ${managed.id}`)

      // Queue recovery: find orphaned queued messages from crash/restart and re-queue them
      const orphanedQueued = managed.messages.filter(m =>
        m.role === 'user' && m.isQueued === true
      )
      if (orphanedQueued.length > 0) {
        sessionLog.info(`Recovering ${orphanedQueued.length} queued message(s) for session ${managed.id}`)
        for (const msg of orphanedQueued) {
          managed.messageQueue.push({
            message: msg.content,
            messageId: msg.id,
            attachments: undefined,  // Attachments already stored on disk
            storedAttachments: msg.attachments,
            options: msg.queuedWorkspaceFreshnessContext
              ? { workspaceFreshnessContext: msg.queuedWorkspaceFreshnessContext }
              : undefined,
          })
        }
        // Process queue when session becomes active (will be triggered by first message or interaction)
        // Use setImmediate to avoid blocking the load and allow session state to settle
        if (!managed.isProcessing && managed.messageQueue.length > 0) {
          setImmediate(() => {
            this.processNextQueuedMessage(managed.id)
          })
        }
      }
    }
    managed.messagesLoaded = true
  }

  /**
   * Get the filesystem path to a session's folder
   */
  getSessionPath(sessionId: string): string | null {
    const managed = this.sessions.get(sessionId)
    if (!managed) return null
    return getSessionStoragePath(managed.workspace.rootPath, sessionId)
  }

  async createSession(workspaceId: string, options?: import('@craft-agent/shared/protocol').CreateSessionOptions): Promise<Session> {
    const workspace = resolveRuntimeWorkspace(workspaceId)
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`)
    }

    // Get new session defaults from workspace config (with global fallback)
    // Options.permissionMode overrides the workspace default (used by EditPopover for auto-execute)
    const workspaceRootPath = workspace.rootPath
    const wsConfig = loadWorkspaceConfig(workspaceRootPath)
    const globalDefaults = loadConfigDefaults()

    // Read permission mode from workspace config, fallback to global defaults
    const defaultPermissionMode = options?.permissionMode
      ?? wsConfig?.defaults?.permissionMode
      ?? globalDefaults.workspaceDefaults.permissionMode

    const userDefaultWorkingDir = wsConfig?.defaults?.workingDirectory || workspaceRootPath
    // Resolve thinking level with caller-first precedence, matching permissionMode above:
    //   caller override → workspace default → global default.
    // normalizeThinkingLevel() tolerates undefined/unknown inputs.
    const defaultThinkingLevel =
      normalizeThinkingLevel(options?.thinkingLevel)
      ?? normalizeThinkingLevel(wsConfig?.defaults?.thinkingLevel)
      ?? getDefaultThinkingLevel()
    // Get default model from workspace config (used when no session-specific model is set)
    const defaultModel = wsConfig?.defaults?.model
    // Get default enabled sources from workspace config
    const defaultEnabledSourceSlugs = options?.enabledSourceSlugs ?? wsConfig?.defaults?.enabledSourceSlugs

    // Resolve model tier hints ('fast' / 'default') to actual model IDs.
    // EditPopover uses tier hints instead of hardcoded Anthropic model names
    // so the right model is selected regardless of the active LLM provider.
    let resolvedModelOption = options?.model || defaultModel
    if (resolvedModelOption === 'fast' || resolvedModelOption === 'default') {
      const tierConnection = resolveSessionConnection(
        options?.llmConnection,
        wsConfig?.defaults?.defaultLlmConnection,
      )
      if (tierConnection) {
        resolvedModelOption = resolvedModelOption === 'fast'
          ? (getMiniModel(tierConnection) ?? tierConnection.defaultModel ?? defaultModel)
          : (tierConnection.defaultModel ?? defaultModel)
      } else {
        resolvedModelOption = defaultModel
      }
    }

    // Resolve backend target early for branching policy checks.
    const targetBackendContext = resolveBackendContext({
      sessionConnectionSlug: options?.llmConnection,
      workspaceDefaultConnectionSlug: wsConfig?.defaults?.defaultLlmConnection,
      managedModel: resolvedModelOption,
    })
    const targetProviderType = targetBackendContext.connection?.providerType
      ?? 'pi'
    const targetPiAuthProvider = targetBackendContext.connection?.piAuthProvider

    // Resolve working directory from options:
    // - 'user_default' or undefined: Use workspace's configured default
    // - 'none': Use the private session folder (materialized after storage allocates the ID)
    // - Absolute path: Use as-is
    let resolvedWorkingDir: string | undefined
    if (isFreeConversationWorkspaceId(workspace.id)) {
      // The concrete path is derived after storage allocates the session ID.
      // Free Conversations never inherit a project or user-default cwd.
      resolvedWorkingDir = undefined
    } else if (options?.workingDirectory === 'none') {
      resolvedWorkingDir = undefined
    } else if (options?.workingDirectory === 'user_default' || options?.workingDirectory === undefined) {
      resolvedWorkingDir = userDefaultWorkingDir
    } else {
      resolvedWorkingDir = options.workingDirectory
    }

    // Validate branch request up-front so branch metadata is only set for valid branches.
    // This prevents creating sessions that claim to be branched but don't have copied history.
    let validatedBranch: {
      sourceSessionId: string
      sourceMessageId: string
      sourceSession: StoredSession
      branchIdx: number
      branchContextStrategy: 'sdk-fork' | 'seeded-fresh-session'
      branchFromSdkSessionId?: string
      branchFromSessionPath?: string
      branchFromSdkTurnId?: string
    } | undefined

    if (options?.branchFromSessionId || options?.branchFromMessageId) {
      if (!options.branchFromSessionId || !options.branchFromMessageId) {
        sessionLog.warn('Branch validation failed: missing branchFromSessionId or branchFromMessageId', {
          workspaceId,
          branchFromSessionId: options.branchFromSessionId,
          branchFromMessageId: options.branchFromMessageId,
        })
        throw new Error('Invalid branch request: both branchFromSessionId and branchFromMessageId are required')
      }

      const sourceManaged = this.sessions.get(options.branchFromSessionId)
      if (sourceManaged) {
        if (sourceManaged.workspace.rootPath !== workspaceRootPath) {
          sessionLog.warn('Branch validation failed: source session belongs to different workspace', {
            workspaceId,
            targetWorkspaceRootPath: workspaceRootPath,
            sourceWorkspaceRootPath: sourceManaged.workspace.rootPath,
            branchFromSessionId: options.branchFromSessionId,
          })
          throw new Error('Invalid branch request: source session belongs to a different workspace')
        }

        // Flush source session to disk to ensure latest message list is available for branch copy.
        this.persistSession(sourceManaged)
        await sessionPersistenceQueue.flush(sourceManaged.id)
      }

      const sourceSession = loadStoredSession(workspaceRootPath, options.branchFromSessionId)
      if (!sourceSession) {
        sessionLog.warn('Branch validation failed: source session not found on disk', {
          workspaceId,
          branchFromSessionId: options.branchFromSessionId,
        })
        throw new Error(`Invalid branch request: source session ${options.branchFromSessionId} not found`)
      }

      const sourceBackendContext = resolveBackendContext({
        sessionConnectionSlug: sourceManaged?.llmConnection || sourceSession.llmConnection,
        workspaceDefaultConnectionSlug: wsConfig?.defaults?.defaultLlmConnection,
        managedModel: sourceManaged?.model || sourceSession.model,
      })
      const sourceProviderType = sourceBackendContext.connection?.providerType
        ?? 'pi'
      const sourcePiAuthProvider = sourceBackendContext.connection?.piAuthProvider

      const providerTypeMismatch = sourceProviderType !== targetProviderType
      const piAuthProviderMismatch = sourcePiAuthProvider !== targetPiAuthProvider

      if (providerTypeMismatch || piAuthProviderMismatch) {
        sessionLog.warn('Branch validation failed: source and target model providers are incompatible', {
          workspaceId,
          branchFromSessionId: options.branchFromSessionId,
          sourceProviderType,
          sourcePiAuthProvider,
          targetProviderType,
          targetPiAuthProvider,
        })
        throw new Error('Branching is only supported within the same model provider and auth context. Switch this panel connection and try again.')
      }

      const branchIdx = sourceSession.messages.findIndex(m => m.id === options.branchFromMessageId)
      if (branchIdx === -1) {
        sessionLog.warn('Branch validation failed: message not found in source session', {
          workspaceId,
          branchFromSessionId: options.branchFromSessionId,
          branchFromMessageId: options.branchFromMessageId,
        })
        throw new Error(`Invalid branch request: message ${options.branchFromMessageId} not found in source session`)
      }

      // New branches always use strict provider-level SDK fork semantics.
      // Seeded mode remains only for legacy sessions created before strict fork was enforced.
      const branchContextStrategy: 'sdk-fork' | 'seeded-fresh-session' = 'sdk-fork'

      const branchFromSdkSessionId = branchContextStrategy === 'sdk-fork'
        ? (sourceManaged?.sdkSessionId || sourceSession.sdkSessionId)
        : undefined
      const branchFromSessionPath = branchContextStrategy === 'sdk-fork'
        ? getSessionStoragePath(workspaceRootPath, options.branchFromSessionId)
        : undefined

      // Pi session entry ID loaded from sidecar (pi-turn-anchors.json).
      let branchFromSdkTurnId: string | undefined
      if (branchContextStrategy === 'sdk-fork' && branchFromSessionPath) {
        branchFromSdkTurnId = await getPiTurnAnchor(branchFromSessionPath, options.branchFromMessageId)
        if (!branchFromSdkTurnId) {
          sessionLog.warn('Pi branch anchor missing: rejecting unsafe SDK fork branch', {
            workspaceId,
            branchFromSessionId: options.branchFromSessionId,
            branchFromMessageId: options.branchFromMessageId,
          })
        }
      }

      if (branchContextStrategy === 'sdk-fork' && !branchFromSdkSessionId) {
        sessionLog.warn('Branch validation failed: sdk-fork requires parent SDK session ID', {
          workspaceId,
          branchFromSessionId: options.branchFromSessionId,
        })
        throw new Error('Cannot create branch yet: parent session SDK context is not initialized. Send one message in the parent session and try again.')
      }

      if (branchContextStrategy === 'sdk-fork') {
        branchFromSdkTurnId = requireSdkForkBranchAnchor({
          branchFromSessionId: options.branchFromSessionId,
          branchFromMessageId: options.branchFromMessageId,
          branchFromSdkTurnId,
        })
      }

      validatedBranch = {
        sourceSessionId: options.branchFromSessionId,
        sourceMessageId: options.branchFromMessageId,
        sourceSession,
        branchIdx,
        branchContextStrategy,
        branchFromSdkSessionId,
        branchFromSessionPath,
        branchFromSdkTurnId,
      }

      sessionLog.info('Branch validation succeeded', {
        workspaceId,
        branchFromSessionId: validatedBranch.sourceSessionId,
        branchFromMessageId: validatedBranch.sourceMessageId,
        branchContextStrategy: validatedBranch.branchContextStrategy,
        branchFromSdkSessionId: !!validatedBranch.branchFromSdkSessionId,
        copiedMessageCount: validatedBranch.branchIdx + 1,
      })
    }

    // Use storage layer to create and persist the session
    const storedSession = await createStoredSession(workspaceRootPath, {
      name: options?.name,
      permissionMode: defaultPermissionMode,
      workingDirectory: resolvedWorkingDir,
      hidden: options?.hidden,
      sessionStatus: options?.sessionStatus,
      labels: options?.labels,
      isFlagged: options?.isFlagged,
    })

    if (isFreeConversationWorkspaceId(workspace.id)) {
      const privateWorkingDirectory = join(
        getSessionStoragePath(workspaceRootPath, storedSession.id),
        'work',
      )
      await mkdir(privateWorkingDirectory, { recursive: true })
      await updateSessionMetadata(workspaceRootPath, storedSession.id, {
        workingDirectory: privateWorkingDirectory,
        sdkCwd: privateWorkingDirectory,
      })
      storedSession.workingDirectory = privateWorkingDirectory
      storedSession.sdkCwd = privateWorkingDirectory
      resolvedWorkingDir = privateWorkingDirectory
    } else if (options?.workingDirectory === 'none') {
      const sessionWorkingDirectory = getSessionStoragePath(workspaceRootPath, storedSession.id)
      await updateSessionMetadata(workspaceRootPath, storedSession.id, {
        workingDirectory: sessionWorkingDirectory,
      })
      storedSession.workingDirectory = sessionWorkingDirectory
      resolvedWorkingDir = sessionWorkingDirectory
    }

    // Branch: copy messages from source session up to and including the branch point
    if (validatedBranch) {
      const branchedStored = loadStoredSession(workspaceRootPath, storedSession.id)
      if (!branchedStored) {
        throw new Error(`Failed to load newly created session ${storedSession.id} for branch copy`)
      }

      const sourceMessages = validatedBranch.sourceSession.messages.slice(0, validatedBranch.branchIdx + 1)

      // Re-map embedded paths: source messages were loaded with expandSessionPath(sourceDir),
      // so they contain absolute paths to the *source* session directory. When saved to the
      // branch session, makeSessionPathPortable uses the *branch* dir — which won't match.
      // Fix: replace source dir paths with branch dir paths so tokenization works on save.
      const sourceDir = normalizePath(getSessionStoragePath(workspaceRootPath, validatedBranch.sourceSessionId))
      const branchDir = normalizePath(getSessionStoragePath(workspaceRootPath, storedSession.id))
      if (sourceDir !== branchDir) {
        branchedStored.messages = sourceMessages.map(m => {
          const json = JSON.stringify(m)
          if (!json.includes(sourceDir)) return m
          return JSON.parse(json.replaceAll(sourceDir, branchDir)) as StoredMessage
        })
      } else {
        branchedStored.messages = sourceMessages
      }

      branchedStored.branchFromMessageId = validatedBranch.sourceMessageId
      branchedStored.branchFromSdkSessionId = validatedBranch.branchFromSdkSessionId
      branchedStored.branchFromSessionPath = validatedBranch.branchFromSessionPath
      branchedStored.branchFromSdkTurnId = validatedBranch.branchFromSdkTurnId
      await saveStoredSession(branchedStored)
    }

    // Resolve connection/provider/auth/model using the provider-agnostic backend resolver.
    // Reuse precomputed target context so branch validation and session construction share the same target identity.
    const resolvedContext = targetBackendContext
    const resolvedModel = resolvedContext.resolvedModel

    // Log mini agent session creation
    if (options?.systemPromptPreset === 'mini' || options?.model) {
      sessionLog.info(`🤖 Creating mini agent session: model=${resolvedModel}, systemPromptPreset=${options?.systemPromptPreset}`)
    }

    const isBranch = !!validatedBranch

    const managed = createManagedSession(storedSession, workspace, {
      permissionMode: defaultPermissionMode,
      workingDirectory: resolvedWorkingDir,
      model: resolvedModel,
      llmConnection: options?.llmConnection,
      thinkingLevel: defaultThinkingLevel,
      systemPromptPreset: options?.systemPromptPreset,
      enabledSourceSlugs: defaultEnabledSourceSlugs,
      branchFromMessageId: validatedBranch?.sourceMessageId,
      branchContextStrategy: validatedBranch?.branchContextStrategy,
      branchFromSdkSessionId: validatedBranch?.branchFromSdkSessionId,
      branchFromSessionPath: validatedBranch?.branchFromSessionPath,
      branchFromSdkTurnId: validatedBranch?.branchFromSdkTurnId,
      branchSeedApplied: validatedBranch ? validatedBranch.branchContextStrategy === 'sdk-fork' : undefined,
      // The fork is being established by the current Pi runtime. If preflight
      // fails, branch rollback removes the session instead of persisting ambiguity.
      needsPiMigrationSeed: false,
      messagesLoaded: !isBranch,  // Branched sessions: lazy-load messages from JSONL
    })

    // Eagerly load messages for branched sessions so the renderer gets the full
    // conversation immediately (needed for scroll-to-bottom on panel open)
    if (isBranch) {
      await this.ensureMessagesLoaded(managed)
      this.sessions.set(storedSession.id, managed)

      const requiresBranchPreflight = managed.branchContextStrategy === 'sdk-fork'
      if (requiresBranchPreflight) {
        // Enforce branch correctness at creation time.
        // A branch is only valid if backend context can be established now,
        // not deferred to the first user message.
        try {
          await this.withAgentRuntimeLock(managed, async () => {
            const agent = await this.getOrCreateAgentLocked(managed)
            await agent.ensureBranchReady()
          })
        } catch (error) {
          sessionLog.warn('Branch creation failed during backend preflight handshake', {
            workspaceId,
            sessionId: storedSession.id,
            branchFromSessionId: validatedBranch?.sourceSessionId,
            branchFromMessageId: validatedBranch?.sourceMessageId,
            branchContextStrategy: managed.branchContextStrategy,
            error: error instanceof Error ? error.message : String(error),
          })

          await rollbackFailedBranchCreation({
            managed,
            workspaceRootPath,
            sessionId: storedSession.id,
            deleteFromRuntimeSessions: (id) => {
              this.sessions.delete(id)
            },
            deleteStoredSession,
          })

          throw new Error(
            `Could not create branch: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
    }

    // Initialize mode-manager state immediately to avoid UI/enforcement races
    // before the agent instance is lazily created.
    setPermissionMode(storedSession.id, managed.permissionMode ?? 'ask', { changedBy: 'restore' })
    if (managed.previousPermissionMode) {
      hydratePreviousPermissionMode(storedSession.id, managed.previousPermissionMode)
    }

    this.sessions.set(storedSession.id, managed)

    // Initialize session metadata in AutomationSystem for diffing
    const automationSystem = this.automationSystems.get(workspaceRootPath)
    if (automationSystem) {
      automationSystem.setInitialSessionMetadata(storedSession.id, {
        permissionMode: storedSession.permissionMode,
        labels: storedSession.labels,
        isFlagged: storedSession.isFlagged,
        sessionStatus: storedSession.sessionStatus,
        sessionName: managed.name,
      })
    }

    return managedToSession(managed, isBranch ? { messages: managed.messages } : undefined)
  }

  /**
   * In-place rewind: truncate craft transcript at a user message and move the
   * Pi session leaf via native navigateTree. Same session id; no fork/new session.
   */
  async rewindUserMessage(
    sessionId: string,
    userMessageId: string,
  ): Promise<{ draftText: string }> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      throw new Error(`Session ${sessionId} not found`)
    }

    await this.ensureMessagesLoaded(managed)

    const messageIndex = managed.messages.findIndex(message => message.id === userMessageId)
    if (messageIndex === -1) {
      throw new Error(`Message ${userMessageId} not found in session ${sessionId}`)
    }

    const target = managed.messages[messageIndex]
    if (target?.role !== 'user') {
      throw new Error('Only user messages can be rewound')
    }

    const draftText = typeof target.content === 'string' ? target.content : ''
    const hasPriorUserMessage = managed.messages
      .slice(0, messageIndex)
      .some(message => message.role === 'user')

    if (managed.isProcessing || managed.messageQueue.length > 0) {
      throw new Error('Cannot rewind while this conversation is processing or has queued messages')
    }

    const sessionPath = getSessionStoragePath(managed.workspace.rootPath, sessionId)
    const hasPiTranscript = hasPersistedPiTranscript(sessionPath)

    if (hasPiTranscript) {
      // Rewind is a model-free Pi tree operation. Reuse the loaded session even
      // when a newly selected provider will require a restart on the next send.
      await this.withAgentRuntimeLock(managed, async () => {
        if (managed.isProcessing || managed.messageQueue.length > 0) {
          throw new Error('Cannot rewind while this conversation is processing or has queued messages')
        }
        let agent = managed.agent
        if (!agent) {
          agent = await this.getOrCreateAgentLocked(managed)
        }
        try {
          await agent.rewindUserMessage(target.id)
        } catch (error) {
          managed.pendingConversationRewind = undefined
          throw error
        }
      })
    } else if (hasPriorUserMessage) {
      // Mid-history without a provider session file would desync UI transcript from LLM context.
      throw new Error(
        'Cannot rewind this message yet: provider session is not initialized. Send one message and try again.',
      )
    } else {
      const prepared = await this.handleConversationRewind(managed, {
        phase: 'prepare',
        boundary: { retainThroughMessageId: null },
      })
      if (prepared.phase !== 'prepared') throw new Error('Failed to prepare local conversation rewind')
      await this.handleConversationRewind(managed, {
        phase: 'commit',
        token: prepared.token,
        expectedRevision: prepared.revision,
      })
    }

    return { draftText }
  }

  private conversationRewindRevision(managed: ManagedSession): string {
    return createHash('sha256')
      .update(JSON.stringify({ messages: managed.messages, queue: managed.messageQueue }))
      .digest('hex')
  }

  private async handleConversationRewind(
    managed: ManagedSession,
    request: ConversationRewindRequest,
  ): Promise<ConversationRewindResult> {
    await this.ensureMessagesLoaded(managed)

    if (request.phase === 'abort') {
      if (managed.pendingConversationRewind?.token === request.token) {
        managed.pendingConversationRewind = undefined
      }
      return { phase: 'aborted' }
    }

    if (request.phase === 'prepare') {
      const retainIndex = request.boundary.retainThroughMessageId === null
        ? -1
        : managed.messages.findIndex(message => message.id === request.boundary.retainThroughMessageId)
      if (request.boundary.retainThroughMessageId !== null && retainIndex === -1) {
        throw new Error(`Product rewind boundary ${request.boundary.retainThroughMessageId} is no longer on the active transcript`)
      }
      if (managed.isProcessing || managed.messageQueue.length > 0 || managed.rewindCommitInProgress) {
        throw new Error('Cannot prepare rewind while this conversation is processing or has queued messages')
      }
      if (
        managed.pendingConversationRewind
        && managed.pendingConversationRewind.expiresAt > Date.now()
      ) {
        throw new Error('Another conversation rewind is already prepared')
      }

      const reservation = {
        token: randomUUID(),
        boundary: request.boundary,
        revision: this.conversationRewindRevision(managed),
        expiresAt: Date.now() + 30_000,
      }
      managed.pendingConversationRewind = reservation
      return { phase: 'prepared', token: reservation.token, revision: reservation.revision }
    }

    const reservation = managed.pendingConversationRewind
    if (!reservation || reservation.token !== request.token) {
      throw new Error('Conversation rewind reservation is missing or no longer active')
    }
    managed.pendingConversationRewind = undefined
    if (reservation.expiresAt <= Date.now()) {
      throw new Error('Conversation rewind reservation expired')
    }
    if (
      request.expectedRevision !== reservation.revision
      || this.conversationRewindRevision(managed) !== reservation.revision
    ) {
      throw new Error('Conversation changed after rewind was prepared')
    }

    const boundary = reservation.boundary
    const retainIndex = boundary.retainThroughMessageId === null
      ? -1
      : managed.messages.findIndex(message => message.id === boundary.retainThroughMessageId)
    if (boundary.retainThroughMessageId !== null && retainIndex === -1) {
      throw new Error(`Product rewind boundary ${boundary.retainThroughMessageId} is no longer on the active transcript`)
    }

    const snapshot = {
      messages: managed.messages,
      messageQueue: managed.messageQueue,
      streamingText: managed.streamingText,
      lastMessageRole: managed.lastMessageRole,
      lastFinalMessageId: managed.lastFinalMessageId,
      messageCount: managed.messageCount,
      preview: managed.preview,
    }
    managed.rewindCommitInProgress = true
    try {
      managed.messages = managed.messages.slice(0, retainIndex + 1)
      const lastUser = [...managed.messages].reverse().find(message => message.role === 'user')
      const lastFinalAssistant = [...managed.messages].reverse().find(
        message => message.role === 'assistant' && !message.isIntermediate,
      )
      managed.lastMessageRole = lastFinalAssistant ? 'assistant' : lastUser ? 'user' : undefined
      managed.lastFinalMessageId = lastFinalAssistant?.id
      managed.messageCount = managed.messages.length
      managed.preview = typeof lastUser?.content === 'string' ? lastUser.content.slice(0, 200) : ''

      this.enqueuePersistStrict(managed)
      await this.flushSession(managed.id)
      this.sendEvent({
        type: 'messages_rewound',
        sessionId: managed.id,
        messages: managed.messages,
        ...(boundary.draftText !== undefined ? { draftText: boundary.draftText } : {}),
      }, managed.workspace.id)
      return { phase: 'committed' }
    } catch (error) {
      Object.assign(managed, snapshot)
      try {
        this.enqueuePersistStrict(managed)
        await this.flushSession(managed.id)
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], `Failed to rewind and restore product session ${managed.id}`)
      }
      throw error
    } finally {
      managed.rewindCommitInProgress = false
    }
  }

  private async disposeManagedAgentRuntime(managed: ManagedSession, reason: string): Promise<void> {
    const sessionId = managed.id

    if (managed.agent) {
      try {
        if (managed.agent.disposeForRestart) {
          await managed.agent.disposeForRestart()
        } else {
          managed.agent.dispose()
        }
      } catch (error) {
        sessionLog.warn(`Failed to dispose agent for ${sessionId} during ${reason}: ${error instanceof Error ? error.message : error}`)
      }
    }

    if (managed.mcpPool) {
      try {
        await managed.mcpPool.disconnectAll()
      } catch (error) {
        sessionLog.warn(`Failed to disconnect MCP pool for ${sessionId} during ${reason}: ${error instanceof Error ? error.message : error}`)
      }
    }

    managed.agent = null
    managed.mcpPool = undefined
    managed.envOverrides = undefined
    managed.agentReady = undefined
    managed.agentReadyResolve = undefined
    managed.backendRuntimeSignature = undefined
    managed.backendRestartSignature = undefined
    managed.credentialRestartRequired = false
    unregisterSessionScopedToolCallbacks(sessionId)
  }

  private assertAgentRuntimeOpen(managed: ManagedSession, expectedEpoch?: number): void {
    if (this.sessions.get(managed.id) !== managed || managed.runtimeState) {
      throw new Error(`Session ${managed.id} is closing`)
    }
    if (expectedEpoch !== undefined && (managed.runtimeEpoch ?? 0) !== expectedEpoch) {
      throw new Error(`Session ${managed.id} runtime was invalidated`)
    }
  }

  private async withAgentRuntimeMutex<T>(
    managed: ManagedSession,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = this.agentRuntimeLocks.get(managed.id) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const slot = previous.catch(() => undefined).then(() => gate)
    this.agentRuntimeLocks.set(managed.id, slot)
    await previous.catch(() => undefined)
    try {
      return await work()
    } finally {
      release()
      if (this.agentRuntimeLocks.get(managed.id) === slot) {
        this.agentRuntimeLocks.delete(managed.id)
      }
    }
  }

  private waitForAgentRuntimeLeases(sessionId: string): Promise<void> {
    if ((this.agentRuntimeLeaseCounts.get(sessionId) ?? 0) === 0) return Promise.resolve()
    return new Promise(resolve => {
      const waiters = this.agentRuntimeLeaseWaiters.get(sessionId) ?? new Set<() => void>()
      waiters.add(resolve)
      this.agentRuntimeLeaseWaiters.set(sessionId, waiters)
    })
  }

  private retainAgentRuntimeLease(sessionId: string): void {
    this.agentRuntimeLeaseCounts.set(sessionId, (this.agentRuntimeLeaseCounts.get(sessionId) ?? 0) + 1)
  }

  private releaseAgentRuntimeLease(sessionId: string): void {
    const remaining = (this.agentRuntimeLeaseCounts.get(sessionId) ?? 1) - 1
    if (remaining > 0) {
      this.agentRuntimeLeaseCounts.set(sessionId, remaining)
      return
    }
    this.agentRuntimeLeaseCounts.delete(sessionId)
    const waiters = this.agentRuntimeLeaseWaiters.get(sessionId)
    this.agentRuntimeLeaseWaiters.delete(sessionId)
    for (const resolve of waiters ?? []) resolve()
  }

  /** Keep short pre-runtime session work ahead of deletion and invalidation. */
  private beginSessionOperationLease(managed: ManagedSession): () => void {
    this.assertAgentRuntimeOpen(managed)
    this.retainAgentRuntimeLease(managed.id)
    let retained = true
    return () => {
      if (!retained) return
      retained = false
      this.releaseAgentRuntimeLease(managed.id)
    }
  }

  private async withAgentRuntimeLock<T>(
    managed: ManagedSession,
    work: () => Promise<T>,
    allowClosing = false,
  ): Promise<T> {
    if (!allowClosing) this.assertAgentRuntimeOpen(managed)
    return this.withAgentRuntimeMutex(managed, async () => {
      if (!allowClosing) this.assertAgentRuntimeOpen(managed)
      await this.waitForAgentRuntimeLeases(managed.id)
      if (!allowClosing) this.assertAgentRuntimeOpen(managed)
      return work()
    })
  }

  /**
   * Retain one stable Pi subprocess for a compatible operation. Chat and
   * ephemeral llm_query calls may coexist; refresh, rewind, Source mutation,
   * credential changes, and disposal wait for every retained operation.
   */
  private async withAgentRuntimeLease<T>(
    managed: ManagedSession,
    work: (agent: AgentInstance) => Promise<T>,
  ): Promise<T> {
    this.assertAgentRuntimeOpen(managed)
    const expectedEpoch = managed.runtimeEpoch ?? 0
    const agent = await this.withAgentRuntimeMutex(managed, async () => {
      this.assertAgentRuntimeOpen(managed, expectedEpoch)
      let agent = managed.agent
      if (
        !agent
        || managed.credentialRestartRequired
        || (this.agentRuntimeLeaseCounts.get(managed.id) ?? 0) === 0
      ) {
        await this.waitForAgentRuntimeLeases(managed.id)
        this.assertAgentRuntimeOpen(managed, expectedEpoch)
        agent = await this.getOrCreateAgentLocked(managed)
      }
      this.retainAgentRuntimeLease(managed.id)
      return agent
    })
    try {
      return await work(agent)
    } finally {
      this.releaseAgentRuntimeLease(managed.id)
    }
  }

  /**
   * Refresh an existing agent's runtime config in place when the session's
   * resolved connection signature has drifted from what the agent was created
   * with. No-ops when the agent doesn't exist, when the signature still
   * matches, or when the agent is mid-stream (the gate is `agent.isProcessing()`
   * — `managed.isProcessing` is not used because `sendMessage` flips it before
   * calling `getOrCreateAgent`, which would make every send-path refresh dead
   * code).
   *
   * Concurrency: per-session serialization via `agentRuntimeLocks`. A second
   * caller (e.g. `sendMessage` arriving mid-`SAVE`-refresh) awaits the
   * in-flight refresh, then re-evaluates from the post-refresh state — so the
   * subsequent `agent.chat()` is sent only after the subprocess has applied
   * the runtime update (or the agent has been disposed for recreation).
   *
   * The helper distinguishes two kinds of drift:
   *   - Restart-required (provider/auth/slug/piAuthProvider): goes straight
   *     to dispose + recreate because `update_runtime_config` cannot fully
   *     re-route credential/provider state in a live subprocess.
   *   - In-place safe (model/baseUrl/customEndpoint/customModels): attempts
   *     `agent.updateRuntimeConfig` and falls back to dispose if the backend
   *     can't apply the update.
   */
  private async tryRefreshAgentRuntime(managed: ManagedSession, reason: string): Promise<void> {
    await this.withAgentRuntimeLock(managed, () => this.tryRefreshAgentRuntimeLocked(managed, reason))
  }

  private async tryRefreshAgentRuntimeLocked(managed: ManagedSession, reason: string): Promise<void> {
    if (!managed.agent) return

    const workspaceConfig = loadWorkspaceConfig(managed.workspace.rootPath)
    const backendContext = resolveBackendContext({
      sessionConnectionSlug: managed.llmConnection,
      workspaceDefaultConnectionSlug: workspaceConfig?.defaults?.defaultLlmConnection,
      managedModel: managed.model,
    })
    const connection = backendContext.connection
    const sigInput = {
      connection,
      authType: backendContext.authType,
      resolvedModel: backendContext.resolvedModel,
      enable1MContext: getEnable1MContext(),
      extendedPromptCache: getExtendedPromptCache(),
    }
    const runtimeSignature = buildBackendRuntimeSignature(sigInput)
    const restartSignature = buildRestartRequiredSignature(sigInput)

    if (!managed.backendRuntimeSignature || !managed.backendRestartSignature) {
      managed.backendRuntimeSignature = runtimeSignature
      managed.backendRestartSignature = restartSignature
      return
    }

    const restartRequired = managed.backendRestartSignature !== restartSignature
    const runtimeChanged = managed.backendRuntimeSignature !== runtimeSignature

    if (!restartRequired && !runtimeChanged) return

    if (managed.agent.isProcessing()) {
      sessionLog.info(`Runtime config changed for ${managed.id}; deferring refresh until session is idle (${reason})`)
      return
    }

    await this.runAgentRuntimeRefresh(
      managed,
      backendContext,
      runtimeSignature,
      restartSignature,
      restartRequired,
      reason,
    )
  }

  private async runAgentRuntimeRefresh(
    managed: ManagedSession,
    backendContext: ReturnType<typeof resolveBackendContext>,
    runtimeSignature: string,
    restartSignature: string,
    restartRequired: boolean,
    reason: string,
  ): Promise<void> {
    if (restartRequired) {
      sessionLog.info(`Restart-required field changed for session ${managed.id}; recreating backend runtime (${reason})`)
      await this.disposeManagedAgentRuntime(managed, 'restart-required runtime change')
      return
    }

    const connection = backendContext.connection
    let refreshed = false
    if (managed.agent?.updateRuntimeConfig) {
      try {
        refreshed = await managed.agent.updateRuntimeConfig({
          model: backendContext.resolvedModel,
          providerType: connection?.providerType,
          authType: backendContext.authType,
          runtime: connection ? {
            baseUrl: connection.baseUrl,
            piAuthProvider: connection.piAuthProvider,
            customEndpoint: connection.customEndpoint,
            customModels: connection.models?.map(model => {
              if (typeof model === 'string') return model
              const supportsImages = typeof model.supportsImages === 'boolean' ? model.supportsImages : undefined
              const supportsThinking = typeof model.supportsThinking === 'boolean' ? model.supportsThinking : undefined
              const thinkingLevelMap = model.thinkingLevelMap
              if (
                model.contextWindow
                || supportsImages !== undefined
                || supportsThinking !== undefined
                || thinkingLevelMap !== undefined
              ) {
                return {
                  id: model.id,
                  ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
                  ...(supportsImages !== undefined ? { supportsImages } : {}),
                  ...(supportsThinking !== undefined ? { supportsThinking } : {}),
                  ...(thinkingLevelMap !== undefined ? { thinkingLevelMap } : {}),
                }
              }
              return model.id
            }),
          } : undefined,
        })
      } catch (error) {
        sessionLog.warn(`Runtime config in-place refresh failed for ${managed.id}: ${error instanceof Error ? error.message : error}`)
      }
    }

    if (refreshed) {
      managed.backendRuntimeSignature = runtimeSignature
      managed.backendRestartSignature = restartSignature
      sessionLog.info(`Refreshed runtime config for session ${managed.id} (${reason})`)
    } else {
      sessionLog.info(`Recreating backend runtime for session ${managed.id} after config change (${reason})`)
      await this.disposeManagedAgentRuntime(managed, 'runtime config refresh')
    }
  }

  /**
   * Push a connection's runtime updates (e.g. `supportsImages` toggle) to every
   * active session that uses it. Called from the `llmConnections.SAVE` handler
   * so capability changes reach live Pi subprocesses immediately instead of
   * waiting for the next send to lazily notice the signature drift.
   */
  async refreshConnectionRuntime(connectionSlug: string): Promise<void> {
    for (const managed of this.sessions.values()) {
      if (managed.llmConnection !== connectionSlug) continue
      try {
        await this.tryRefreshAgentRuntime(managed, 'connection update')
      } catch (error) {
        sessionLog.warn(`refreshConnectionRuntime failed for ${managed.id}: ${error instanceof Error ? error.message : error}`)
      }
    }
  }

  /**
   * Push a rotated credential into every live backend using this connection.
   * Pi supports this in-place through its existing `token_update` protocol.
   */
  async reloadConnectionCredentials(
    connectionSlug: string,
    managedModelAccess?: ManagedModelAccess,
  ): Promise<void> {
    for (const managed of this.sessions.values()) {
      if (managed.llmConnection !== connectionSlug) continue
      try {
        await this.withAgentRuntimeLock(managed, async () => {
          if (!managed.agent) return
          const reloaded = await managed.agent.reloadCredentials?.(managedModelAccess) ?? false
          if (!reloaded) {
            if (managed.agent.isProcessing()) managed.credentialRestartRequired = true
            else await this.disposeManagedAgentRuntime(managed, 'credential reload')
          }
        })
      } catch (error) {
        sessionLog.warn(`reloadConnectionCredentials failed for ${managed.id}: ${error instanceof Error ? error.message : error}`)
        await this.withAgentRuntimeLock(managed, async () => {
          if (managed.agent?.isProcessing()) managed.credentialRestartRequired = true
          else await this.disposeManagedAgentRuntime(managed, 'failed credential reload')
        })
      }
    }
  }

  /** Revoke all live runtimes that still hold credentials for this connection. */
  async disposeConnectionRuntimes(connectionSlug: string): Promise<void> {
    const targets = [...this.sessions.values()]
      .filter(managed => managed.llmConnection === connectionSlug && managed.runtimeState !== 'deleting')
      .map(managed => {
        const invalidationEpoch = (managed.runtimeEpoch ?? 0) + 1
        managed.runtimeEpoch = invalidationEpoch
        managed.runtimeState = 'invalidating'
        if (managed.agent && (managed.isProcessing || managed.agent.isProcessing())) {
          managed.agent.forceAbort?.(AbortReason.UserStop)
        }
        return { managed, invalidationEpoch }
      })

    await Promise.all(targets.map(({ managed }) => this.withAgentRuntimeLock(
      managed,
      () => this.disposeManagedAgentRuntime(managed, 'connection sign-out'),
      true,
    )))

    for (const { managed, invalidationEpoch } of targets) {
      if (
        this.sessions.get(managed.id) === managed
        && managed.runtimeEpoch === invalidationEpoch
        && managed.runtimeState === 'invalidating'
      ) {
        managed.runtimeState = undefined
      }
    }
  }

  private async ensureManagedCredentialForSessionLocked(
    managed: ManagedSession,
    forceRefresh = false,
  ): Promise<ManagedModelAccess | undefined> {
    return this.resolveManagedModelAccess(managed, forceRefresh)
  }

  /** Resolve managed access without returning or mutating a live runtime. */
  private async resolveManagedModelAccess(
    managed: ManagedSession,
    forceRefresh = false,
  ): Promise<ManagedModelAccess | undefined> {
    const connectionSlug = resolveManagedConnectionSlug(managed)
    if (!isManagedDefaultGatewayConnection(connectionSlug)) return undefined

    const modelAccess = await sessionRuntimeHooks.ensureManagedModelAccessToken(forceRefresh)
    const managedModelAccess = { token: modelAccess.token }
    if (!modelAccess.refreshed) return managedModelAccess

    // Every affected runtime rebuilds before its next operation. Mutating only
    // flags here avoids cross-session lock ordering during token resolution.
    for (const other of this.sessions.values()) {
      if (
        other.agent
        && resolveManagedConnectionSlug(other) === connectionSlug
      ) {
        other.credentialRestartRequired = true
      }
    }
    return managedModelAccess
  }

  private async refreshManagedCredentialForNextTurn(managed: ManagedSession): Promise<void> {
    try {
      await this.withAgentRuntimeLock(managed, async () => {
        const managedModelAccess = await this.ensureManagedCredentialForSessionLocked(managed, true)
        if (!managedModelAccess || !managed.agent) return

        const reloaded = await managed.agent.reloadCredentials?.(managedModelAccess) ?? false
        if (reloaded) {
          managed.credentialRestartRequired = false
          return
        }
        if (!managed.agent.isProcessing()) {
          await this.disposeManagedAgentRuntime(managed, 'managed credential refresh')
        }
      })
    } catch (error) {
      sessionLog.warn(`[managed-access] Credential refresh failed for ${managed.id}: ${error instanceof Error ? error.message : error}`)
    }
  }

  /**
   * Get or create agent for a session (lazy loading)
   * Creates the appropriate backend agent based on LLM connection.
   *
   * Provider resolution order:
   * 1. session.llmConnection (locked after first message)
   * 2. workspace.defaults.defaultLlmConnection
   * 3. global defaultLlmConnection
   * 4. fallback: no connection configured
   */
  private async getOrCreateAgentLocked(managed: ManagedSession): Promise<AgentInstance> {
    if (managed.credentialRestartRequired && managed.agent && !managed.agent.isProcessing()) {
      await this.disposeManagedAgentRuntime(managed, 'deferred credential reload')
    }

    // Refresh runtime config in-place when the connection has drifted since
    // the agent was created. May null out `managed.agent` if the in-place
    // refresh fails, in which case the create branch below rebuilds it.
    await this.tryRefreshAgentRuntimeLocked(managed, 'send-path refresh')

    const workspaceConfig = loadWorkspaceConfig(managed.workspace.rootPath)
    const backendContext = resolveBackendContext({
      sessionConnectionSlug: managed.llmConnection,
      workspaceDefaultConnectionSlug: workspaceConfig?.defaults?.defaultLlmConnection,
      managedModel: managed.model,
    })
    const connection = backendContext.connection
    const sigInput = {
      connection,
      authType: backendContext.authType,
      resolvedModel: backendContext.resolvedModel,
      enable1MContext: getEnable1MContext(),
      extendedPromptCache: getExtendedPromptCache(),
    }
    const runtimeSignature = buildBackendRuntimeSignature(sigInput)
    const restartSignature = buildRestartRequiredSignature(sigInput)

    if (!managed.agent) {
      const managedModelAccess = await this.ensureManagedCredentialForSessionLocked(managed)
      const end = perf.start('agent.create', { sessionId: managed.id })

      // The agent spawns subprocesses that resolve tools from PATH, so this is
      // where the host's shell-environment discovery must have landed.
      await sessionRuntimeHooks.whenSubprocessEnvReady()

      // Lock the connection after first resolution
      // This ensures the session always uses the same provider
      if (connection && !managed.connectionLocked) {
        managed.llmConnection = connection.slug
        managed.connectionLocked = true
        sessionLog.info(`Locked session ${managed.id} to connection "${connection.slug}"`)
        this.persistSession(managed)

        // Keep renderer session capabilities in sync when auto-locking the connection.
        this.sendEvent({
          type: 'connection_changed',
          sessionId: managed.id,
          connectionSlug: connection.slug,
          supportsBranching: resolveSupportsBranching(managed),
        }, managed.workspace.id)
      }

      if (connection) {
        sessionLog.info(`Using LLM connection "${connection.slug}" (${connection.providerType}) for session ${managed.id}`)
      } else {
        sessionLog.warn(`No LLM connection found for session ${managed.id}, using default anthropic provider`)
      }

      // Set up agentReady promise so title generation can await agent creation
      managed.agentReady = new Promise<void>(r => { managed.agentReadyResolve = r })

      // ============================================================
      // Common setup: sources, MCP pool, session config
      // ============================================================

      const sessionPath = getSessionStoragePath(managed.workspace.rootPath, managed.id)
      const hasPiTranscript = hasPersistedPiTranscript(sessionPath)
      const needsRuntimeMigration = !hasPiTranscript && managed.needsPiMigrationSeed
      if (hasPiTranscript) managed.needsPiMigrationSeed = false
      let seedFreshSessionFromRecovery = false

      if (needsRuntimeMigration) {
        // Legacy and Pi session IDs/transcripts are not interchangeable.
        // Retire only the stale runtime pointers; persisted Storyflow messages
        // remain the source for a one-shot seeded Pi start.
        managed.sdkSessionId = undefined
        managed.branchFromSdkSessionId = undefined
        managed.branchFromSessionPath = undefined
        managed.branchFromSdkCwd = undefined
        managed.branchFromSdkTurnId = undefined

        if (managed.branchFromMessageId) {
          managed.branchContextStrategy = 'seeded-fresh-session'
          managed.branchSeedApplied = false
        } else {
          seedFreshSessionFromRecovery = true
        }
        this.persistSession(managed)
        sessionLog.info(`Migrating session ${managed.id} to a fresh Pi transcript with persisted context`)
      }

      const enabledSlugs = managed.enabledSourceSlugs || []
      const allSources = loadAllSources(getResourceProjectRoot(managed.workspace))
      const enabledSources = allSources.filter(s =>
        enabledSlugs.includes(s.config.slug) && isSourceUsable(s)
      )

      // Build server configs for enabled sources
      const { mcpServers, apiServers } = await buildServersFromSources(enabledSources, sessionPath, managed.tokenRefreshManager)

      // Create centralized MCP client pool (all backends use it)
      managed.mcpPool = new McpClientPool({ debug: (msg) => sessionLog.debug(msg), workspaceRootPath: managed.workspace.rootPath, sessionPath })

      // Per-session env overrides
      const miniModel = connection ? (getMiniModel(connection) ?? connection.defaultModel) : undefined
      const envOverrides: Record<string, string> = {
        CRAFT_WORKSPACE_PATH: managed.workspace.rootPath,
        // Pass mini model to SDK subprocess so built-in tools like WebFetch
        // use the correct model for summarization (instead of hardcoded Haiku)
        ...(miniModel ? { ANTHROPIC_DEFAULT_HAIKU_MODEL: miniModel } : {}),
      }
      managed.envOverrides = envOverrides

      // ============================================================
      // Common session + callback config (identical for all backends)
      // ============================================================

      const sessionConfig = {
        id: managed.id,
        workspaceRootPath: managed.workspace.rootPath,
        sdkSessionId: managed.sdkSessionId,
        branchFromSdkSessionId: managed.branchContextStrategy === 'sdk-fork' ? managed.branchFromSdkSessionId : undefined,
        branchFromSessionPath: managed.branchContextStrategy === 'sdk-fork' ? managed.branchFromSessionPath : undefined,
        branchFromSdkCwd: managed.branchContextStrategy === 'sdk-fork' ? managed.branchFromSdkCwd : undefined,
        branchFromSdkTurnId: managed.branchContextStrategy === 'sdk-fork' ? managed.branchFromSdkTurnId : undefined,
        branchFromMessageId: managed.branchFromMessageId,
        createdAt: managed.lastMessageAt,
        lastUsedAt: managed.lastMessageAt,
        workingDirectory: managed.workingDirectory,
        sdkCwd: managed.sdkCwd,
        model: managed.model,
        llmConnection: managed.llmConnection,
        permissionMode: managed.permissionMode,
        previousPermissionMode: managed.previousPermissionMode,
      }

      const onSdkSessionIdUpdate = (sdkSessionId: string) => {
        managed.sdkSessionId = sdkSessionId
        managed.needsPiMigrationSeed = false
        // Retire branch-only fork metadata now that child session is established
        const parentSdkSessionId = managed.branchFromSdkSessionId
        if (consumePendingSdkFork(managed)) {
          sessionLog.info(`Branch fork established for ${managed.id}: child=${sdkSessionId}, retiring parent fork metadata (parent=${parentSdkSessionId ?? 'unknown'})`)
        } else {
          sessionLog.info(`SDK session ID captured for ${managed.id}: ${sdkSessionId}`)
        }
        this.persistSession(managed)
        sessionPersistenceQueue.flush(managed.id)
      }

      const onSdkSessionIdCleared = () => {
        managed.sdkSessionId = undefined
        sessionLog.info(`SDK session ID cleared for ${managed.id} (resume recovery)`)
        this.persistSession(managed)
        sessionPersistenceQueue.flush(managed.id)
      }

      const onBranchForkInvalidated = () => {
        managed.sdkSessionId = undefined
        clearSdkForkFields(managed)
        sessionLog.info(`Branch fork invalidated for ${managed.id}: cleared all fork metadata`)
        this.persistSession(managed)
        sessionPersistenceQueue.flush(managed.id)
      }

      const getRecoveryMessages = () => {
        let relevantMessages = managed.messages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .filter(m => !m.isIntermediate)
          .slice(-6)
        // The current user message has already been persisted before lazy agent
        // creation; exclude it from the migration context because chatImpl sends
        // it separately as the active prompt.
        if (seedFreshSessionFromRecovery && relevantMessages.at(-1)?.role === 'user') {
          relevantMessages = relevantMessages.slice(0, -1)
        }
        return relevantMessages.map(m => ({
          type: m.role as 'user' | 'assistant',
          content: m.content,
        }))
      }

      const getBranchFallbackMessages = () => {
        if (!managed.branchFromMessageId) return []
        return managed.messages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .filter(m => !m.isIntermediate)
          .map(m => ({
            type: m.role as 'user' | 'assistant',
            content: m.content,
          }))
      }

      const getBranchSeedMessages = () => {
        if (managed.branchContextStrategy !== 'seeded-fresh-session') return []
        if (managed.branchSeedApplied) return []

        const seedMessages = managed.messages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .filter(m => !m.isIntermediate)

        return seedMessages.map(m => ({
          type: m.role as 'user' | 'assistant',
          content: m.content,
        }))
      }

      const markBranchSeedApplied = () => {
        if (managed.branchContextStrategy !== 'seeded-fresh-session') return
        if (managed.branchSeedApplied) return
        managed.branchSeedApplied = true
        sessionLog.info('Branch seed context applied', {
          sessionId: managed.id,
          strategy: managed.branchContextStrategy,
        })
      }

      const getTransferredSessionSummary = () => {
        const summary = managed.transferredSessionSummaryApplied ? null : (managed.transferredSessionSummary ?? null)
        sessionLog.info(`[transfer-context] getTransferredSessionSummary for ${managed.id}: applied=${managed.transferredSessionSummaryApplied}, has_summary=${!!managed.transferredSessionSummary}, returning=${summary ? `${summary.length} chars` : 'null'}`)
        return summary
      }

      const markTransferredSessionSummaryApplied = () => {
        if (managed.transferredSessionSummaryApplied || !managed.transferredSessionSummary) return
        managed.transferredSessionSummaryApplied = true
        this.persistSession(managed)
        sessionLog.info('Transferred session summary applied', {
          sessionId: managed.id,
        })
      }

      managed.agent = new PiAgent(resolvePiAgentConfig({
        context: backendContext,
        hostRuntime: buildBackendHostRuntimeContext(),
        coreConfig: {
          workspace: managed.workspace,
          projectRoot: getResourceProjectRoot(managed.workspace),
          miniModel,
          thinkingLevel: managed.thinkingLevel,
          managedModelAccess,
          session: sessionConfig,
          onSdkSessionIdUpdate,
          onSdkSessionIdCleared,
          onBranchForkInvalidated,
          onConversationRewind: request => this.handleConversationRewind(managed, request),
          onCredentialRotated: async () => {
            // Pi already owns the rotated credential for this turn. Queue the
            // cross-session reload after this runtime lease is released.
            void this.reloadConnectionCredentials(
              managed.llmConnection || connection?.slug || 'pi',
            ).catch(error => {
              sessionLog.warn(`Failed to propagate rotated credential: ${error instanceof Error ? error.message : error}`)
            })
          },
          getRecoveryMessages,
          seedFreshSessionFromRecovery,
          getBranchFallbackMessages,
          getBranchSeedMessages,
          markBranchSeedApplied,
          getTransferredSessionSummary,
          markTransferredSessionSummaryApplied,
          mcpPool: managed.mcpPool,
          envOverrides,
          isHeadless: !AGENT_FLAGS.defaultModesEnabled,
          automationSystem: this.automationSystems.get(managed.workspace.rootPath),
          systemPromptPreset: managed.systemPromptPreset,
          debugMode: _platform?.isDebugMode ? { enabled: true, logFilePath: _platform.getLogFilePath?.() } : undefined,
          enable1MContext: getEnable1MContext(),
          // Image resize callback — prevents oversized images from entering conversation history
          onImageResize: async (filePath: string, maxSizeBytes: number): Promise<string | null> => {
            try {
              const buffer = await readFile(filePath)
              const result = await resizeImageForAPI(buffer, { maxSizeBytes })
              if (!result) return null

              // Write to session tmp directory (cleaned up with session)
              const sessionTmpDir = join(sessionPath, 'tmp')
              await mkdir(sessionTmpDir, { recursive: true })
              const ext = result.format === 'jpeg' ? 'jpg' : 'png'
              const outPath = join(sessionTmpDir, `resized-${randomUUID()}.${ext}`)
              await writeFile(outPath, result.buffer)

              sessionLog.info(`Image resized for Read: ${(buffer.length / 1024 / 1024).toFixed(1)}MB → ${(result.buffer.length / 1024 / 1024).toFixed(1)}MB (→ ${result.width}×${result.height})`)
              return outPath
            } catch (err) {
              sessionLog.error('Image resize failed:', err)
              return null
            }
          },
          // Source configs for postInit() — backends set up their own runtime state
          initialSources: {
            enabledSources,
            mcpServers,
            apiServers,
            enabledSlugs,
          },
        },
      }))

      sessionLog.info(`Created Pi agent for session ${managed.id} (model: ${backendContext.resolvedModel})${managed.sdkSessionId ? ' (resuming)' : ''}`)

      // ============================================================
      // Post-construction: debug callback, auth callback, postInit()
      // ============================================================

      managed.agent.onDebug = (msg: string) => {
        const marker = '__PERMISSION_BLOCK__'
        if (msg.includes(marker)) {
          const idx = msg.indexOf(marker)
          const payloadRaw = msg.slice(idx + marker.length)
          try {
            const payload = JSON.parse(payloadRaw) as {
              sessionId: string
              toolName: string
              effectiveMode: string
              modeVersion: number
              changedBy: string
              changedAt: string
              reason: string
            }
            sessionLog.info('Tool blocked by permission mode', payload)
            return
          } catch {
            // fall through to plain logging when payload parsing fails
          }
        }

        sessionLog.info(msg)
      }

      // Unified auth callback — replaces per-backend onChatGptAuthRequired/onGithubAuthRequired
      managed.agent.onBackendAuthRequired = (reason: string) => {
        sessionLog.warn(`Backend auth required for session ${managed.id}: ${reason}`)
        this.sendEvent({
          type: 'info',
          sessionId: managed.id,
          message: `Authentication required: ${reason}`,
          level: 'error',
        }, managed.workspace.id)
      }

      // Run post-init (auth injection) — each backend handles its own
      const postInitResult = await managed.agent.postInit()
      if (postInitResult.authWarning) {
        sessionLog.warn(`Auth warning for session ${managed.id}: ${postInitResult.authWarning}`)
        this.sendEvent({
          type: 'info',
          sessionId: managed.id,
          message: postInitResult.authWarning,
          level: postInitResult.authWarningLevel || 'error',
        }, managed.workspace.id)
      }

      // Wire up large response handling in the MCP pool (all backends)
      if (managed.mcpPool && managed.agent) {
        managed.mcpPool.setSummarizeCallback(managed.agent.getSummarizeCallback())
      }

      // Wire up browser pane tools — merge BrowserPaneFns into session callbacks
      // so browser_* tools can delegate to BrowserPaneManager
      if (this.browserPaneManager) {
        const bpm = this.browserPaneManager
        const sid = managed.id

        const resolveSessionBrowserInstance = (toolName: string, options?: { show?: boolean }): string => {
          const instanceId = bpm.createForSession(sid, { show: options?.show ?? false })
          const info = bpm.getInstance(instanceId)
          sessionLog.info(`[browser-pane] tool target resolved: ${toolName} session=${sid} instance=${instanceId} ownerType=${info?.ownerType ?? 'unknown'} ownerSessionId=${info?.ownerSessionId ?? 'none'} visible=${info?.isVisible ?? false}`)
          return instanceId
        }

        const resolveLifecycleWindowTarget = (command: 'release' | 'close' | 'hide', requestedInstanceId?: string) => {
          const windows = bpm.listInstances()

          if (windows.length === 0) {
            return { windows, reason: 'No browser windows are available. Use "open" first.' }
          }

          const validateTarget = (target: (typeof windows)[number] | undefined) => {
            if (!target) {
              return { ok: false as const, reason: `Browser window "${requestedInstanceId}" not found. Use "windows" to list available windows.` }
            }

            if (target.boundSessionId && target.boundSessionId !== sid) {
              return { ok: false as const, reason: `Browser window "${target.id}" is locked to session ${target.boundSessionId}.` }
            }

            if (!target.boundSessionId && target.ownerSessionId && target.ownerSessionId !== sid) {
              return { ok: false as const, reason: `Browser window "${target.id}" is currently owned by session ${target.ownerSessionId}.` }
            }

            return { ok: true as const, target }
          }

          if (requestedInstanceId) {
            const validated = validateTarget(windows.find((w) => w.id === requestedInstanceId))
            if (!validated.ok) {
              return { windows, reason: validated.reason }
            }
            return { windows, target: validated.target }
          }

          const fallbackTarget = windows.find((w) => w.boundSessionId === sid)
            ?? windows.find((w) => w.ownerSessionId === sid)

          if (!fallbackTarget) {
            return { windows, reason: `No ${command} target is currently associated with this session. Use "windows", then "${command} <id>".` }
          }

          const validated = validateTarget(fallbackTarget)
          if (!validated.ok) {
            return { windows, reason: validated.reason }
          }

          return { windows, target: validated.target }
        }

        mergeSessionScopedToolCallbacks(sid, {
          browserPaneFns: {
            openPanel: async (options) => {
              const instanceId = options?.background
                ? bpm.createForSession(sid, { show: false })
                : bpm.focusBoundForSession(sid)
              const info = bpm.getInstance(instanceId)
              sessionLog.info(`[browser-pane] route decision: browser_open session=${sid} instance=${instanceId} background=${options?.background ?? false} ownerType=${info?.ownerType ?? 'unknown'} ownerSessionId=${info?.ownerSessionId ?? 'none'} visible=${info?.isVisible ?? false}`)
              return { instanceId }
            },
            navigate: (url) => {
              const instanceId = resolveSessionBrowserInstance('browser_navigate')
              return bpm.navigate(instanceId, url)
            },
            snapshot: () => {
              const instanceId = resolveSessionBrowserInstance('browser_snapshot')
              return bpm.getAccessibilitySnapshot(instanceId)
            },
            click: (ref, options) => {
              const instanceId = resolveSessionBrowserInstance('browser_click')
              return bpm.clickElement(instanceId, ref, options)
            },
            clickAt: (x, y) => {
              const instanceId = resolveSessionBrowserInstance('browser_click_at')
              return bpm.clickAtCoordinates(instanceId, x, y)
            },
            drag: (x1, y1, x2, y2) => {
              const instanceId = resolveSessionBrowserInstance('browser_drag')
              return bpm.drag(instanceId, x1, y1, x2, y2)
            },
            fill: (ref, value) => {
              const instanceId = resolveSessionBrowserInstance('browser_fill')
              return bpm.fillElement(instanceId, ref, value)
            },
            type: (text) => {
              const instanceId = resolveSessionBrowserInstance('browser_type')
              return bpm.typeText(instanceId, text)
            },
            select: (ref, value) => {
              const instanceId = resolveSessionBrowserInstance('browser_select')
              return bpm.selectOption(instanceId, ref, value)
            },
            setClipboard: (text) => {
              const instanceId = resolveSessionBrowserInstance('browser_set_clipboard')
              return bpm.setClipboard(instanceId, text)
            },
            getClipboard: () => {
              const instanceId = resolveSessionBrowserInstance('browser_get_clipboard')
              return bpm.getClipboard(instanceId)
            },
            screenshot: (options) => {
              const instanceId = resolveSessionBrowserInstance('browser_screenshot')
              return bpm.screenshot(instanceId, options)
            },
            screenshotRegion: (options) => {
              const instanceId = resolveSessionBrowserInstance('browser_screenshot_region')
              return bpm.screenshotRegion(instanceId, options)
            },
            getConsoleLogs: (options) => {
              const instanceId = resolveSessionBrowserInstance('browser_console')
              return Promise.resolve(bpm.getConsoleLogs(instanceId, options))
            },
            windowResize: (options) => {
              const instanceId = resolveSessionBrowserInstance('browser_window_resize')
              return Promise.resolve(bpm.windowResize(instanceId, options.width, options.height))
            },
            getNetworkLogs: (options) => {
              const instanceId = resolveSessionBrowserInstance('browser_network')
              return Promise.resolve(bpm.getNetworkLogs(instanceId, options))
            },
            waitFor: (options) => {
              const instanceId = resolveSessionBrowserInstance('browser_wait')
              return bpm.waitFor(instanceId, options)
            },
            sendKey: (options) => {
              const instanceId = resolveSessionBrowserInstance('browser_key')
              return bpm.sendKey(instanceId, options)
            },
            getDownloads: (options) => {
              const instanceId = resolveSessionBrowserInstance('browser_downloads')
              return bpm.getDownloads(instanceId, options)
            },
            upload: (ref, filePaths) => {
              const instanceId = resolveSessionBrowserInstance('browser_upload')
              return bpm.uploadFile(instanceId, ref, filePaths).then(() => {})
            },
            scroll: (direction, amount) => {
              const instanceId = resolveSessionBrowserInstance('browser_scroll')
              return bpm.scroll(instanceId, direction, amount)
            },
            goBack: () => {
              const instanceId = resolveSessionBrowserInstance('browser_back')
              return bpm.goBack(instanceId)
            },
            goForward: () => {
              const instanceId = resolveSessionBrowserInstance('browser_forward')
              return bpm.goForward(instanceId)
            },
            evaluate: (expression) => {
              const instanceId = resolveSessionBrowserInstance('browser_evaluate')
              return bpm.evaluate(instanceId, expression)
            },
            focusWindow: async (targetInstanceId) => {
              const windows = bpm.listInstances()
              if (windows.length === 0) {
                throw new Error('No browser windows available to focus. Use "open" first.')
              }

              const target = targetInstanceId
                ? windows.find(w => w.id === targetInstanceId)
                : windows.find(w => w.boundSessionId === sid || w.ownerSessionId === sid)

              if (!target) {
                if (targetInstanceId) {
                  throw new Error(`Browser window "${targetInstanceId}" not found. Use "windows" to list available windows.`)
                }
                throw new Error('No browser window is currently bound to this session. Use "open --foreground" to create or reuse one.')
              }

              const availableToSession = !target.boundSessionId || target.boundSessionId === sid
              if (!availableToSession) {
                throw new Error(`Browser window "${target.id}" is locked to session ${target.boundSessionId}.`)
              }

              if (!target.boundSessionId) {
                bpm.bindSession(target.id, sid)
              }

              bpm.focus(target.id)
              const focused = bpm.getInstance(target.id)
              return {
                instanceId: target.id,
                title: focused?.title ?? target.title,
                url: focused?.currentUrl ?? target.url,
              }
            },
            releaseControl: async (requestedInstanceId) => {
              if (requestedInstanceId === 'all') {
                const before = bpm.listInstances()
                const beforeActive = before.filter((w) => !!w.agentControlActive).length
                bpm.clearAgentControl(sid)
                const after = bpm.listInstances()
                const afterActive = after.filter((w) => !!w.agentControlActive).length
                const released = afterActive < beforeActive

                sessionLog.info(`[browser-pane] lifecycle release-all session=${sid} overlays=${beforeActive}->${afterActive}`)

                return {
                  action: released ? 'released' : 'noop',
                  requestedInstanceId,
                  affectedIds: released ? before.filter((w) => !!w.agentControlActive).map((w) => w.id) : [],
                  reason: released ? undefined : 'No active overlay was found for this session.',
                }
              }

              const resolution = resolveLifecycleWindowTarget('release', requestedInstanceId)
              if (!resolution.target) {
                sessionLog.info(`[browser-pane] lifecycle release session=${sid} requested=${requestedInstanceId ?? 'auto'} result=noop reason=${resolution.reason}`)
                return {
                  action: 'noop',
                  requestedInstanceId,
                  affectedIds: [],
                  reason: resolution.reason,
                }
              }

              const result = bpm.clearAgentControlForInstance(resolution.target.id, sid)
              const action = result.released ? 'released' : 'noop'
              sessionLog.info(`[browser-pane] lifecycle release session=${sid} requested=${requestedInstanceId ?? 'auto'} resolved=${resolution.target.id} result=${action} reason=${result.reason ?? 'none'}`)

              return {
                action,
                requestedInstanceId,
                resolvedInstanceId: resolution.target.id,
                affectedIds: result.released ? [resolution.target.id] : [],
                reason: result.reason,
              }
            },
            closeWindow: async (requestedInstanceId) => {
              const resolution = resolveLifecycleWindowTarget('close', requestedInstanceId)
              if (!resolution.target) {
                sessionLog.info(`[browser-pane] lifecycle close session=${sid} requested=${requestedInstanceId ?? 'auto'} result=noop reason=${resolution.reason}`)
                return {
                  action: 'noop',
                  requestedInstanceId,
                  affectedIds: [],
                  reason: resolution.reason,
                }
              }

              bpm.destroyInstance(resolution.target.id)
              sessionLog.info(`[browser-pane] lifecycle close session=${sid} requested=${requestedInstanceId ?? 'auto'} resolved=${resolution.target.id} result=closed`)

              return {
                action: 'closed',
                requestedInstanceId,
                resolvedInstanceId: resolution.target.id,
                affectedIds: [resolution.target.id],
              }
            },
            hideWindow: async (requestedInstanceId) => {
              const resolution = resolveLifecycleWindowTarget('hide', requestedInstanceId)
              if (!resolution.target) {
                sessionLog.info(`[browser-pane] lifecycle hide session=${sid} requested=${requestedInstanceId ?? 'auto'} result=noop reason=${resolution.reason}`)
                return {
                  action: 'noop',
                  requestedInstanceId,
                  affectedIds: [],
                  reason: resolution.reason,
                }
              }

              bpm.hide(resolution.target.id)
              sessionLog.info(`[browser-pane] lifecycle hide session=${sid} requested=${requestedInstanceId ?? 'auto'} resolved=${resolution.target.id} result=hidden`)

              return {
                action: 'hidden',
                requestedInstanceId,
                resolvedInstanceId: resolution.target.id,
                affectedIds: [resolution.target.id],
              }
            },
            listWindows: async () => {
              return bpm.listInstances()
            },
            detectChallenge: async () => {
              const instanceId = resolveSessionBrowserInstance('browser_detect_challenge')
              return bpm.detectSecurityChallenge(instanceId)
            },
          } satisfies BrowserPaneFns,
        })
      }

      // Signal that the agent instance is ready (unblocks title generation)
      managed.agentReadyResolve?.()

      // Set up permission handler to forward requests to renderer
      managed.agent.onPermissionRequest = (request: {
        requestId: string;
        toolName: string;
        command?: string;
        description: string;
        type?: 'bash' | 'file_write' | 'mcp_mutation' | 'api_mutation' | 'admin_approval';
        appName?: string;
        reason?: string;
        impact?: string;
        requiresSystemPrompt?: boolean;
        rememberForMinutes?: number;
        commandHash?: string;
        approvalTtlSeconds?: number;
      }) => {
        sessionLog.info(`Permission request for session ${managed.id}:`, request.command)
        let brokerMetadata: {
          commandHash?: string
          approvalTtlSeconds?: number
        } = {}

        if (request.type === 'admin_approval' && request.command) {
          const brokerRequest = this.privilegedExecutionBroker.createRequest({
            requestId: request.requestId,
            sessionId: managed.id,
            command: request.command,
            reason: request.reason,
            impact: request.impact,
            approvalTtlSeconds: request.approvalTtlSeconds,
          })

          brokerMetadata = {
            commandHash: brokerRequest.commandHash,
            approvalTtlSeconds: brokerRequest.approvalTtlSeconds,
          }
        }

        const effectiveCommandHash = brokerMetadata.commandHash ?? request.commandHash

        this.pendingPermissionRequests.set(request.requestId, {
          sessionId: managed.id,
          type: request.type,
          commandHash: effectiveCommandHash,
        })

        if (request.type === 'admin_approval' && effectiveCommandHash && this.hasActiveAdminRememberApproval(managed.id, effectiveCommandHash)) {
          const brokerResult = this.privilegedExecutionBroker.resolveApproval(request.requestId, true, {
            expectedCommandHash: effectiveCommandHash,
          })

          this.pendingPermissionRequests.delete(request.requestId)

          if (brokerResult.ok) {
            this.privilegedExecutionBroker.auditEvent('privileged_auto_approved_remember_window', {
              sessionId: managed.id,
              requestId: request.requestId,
              commandHash: effectiveCommandHash,
            })
            const liveAgent = managed.agent
            if (liveAgent) {
              liveAgent.respondToPermission(request.requestId, true, false)
              return
            }
          }

          sessionLog.warn(`Remember-window auto-approval skipped for ${request.requestId}: ${brokerResult.reason}`)
        }

        this.sendEvent({
          type: 'permission_request',
          sessionId: managed.id,
          request: {
            ...request,
            ...brokerMetadata,
            sessionId: managed.id,
          }
        }, managed.workspace.id)
      }

      // Note: Credential requests now flow through onAuthRequest (unified auth flow)
      // The legacy onCredentialRequest callback has been removed from the product projection
      // Auth refresh for mid-session token expiry is handled by the error handler in sendMessage
      // which destroys/recreates the agent to get fresh credentials

      // Set up mode change handlers
      managed.agent.onPermissionModeChange = (mode) => {
        if (managed.permissionMode === mode) {
          return
        }

        managed.permissionMode = mode
        const diagnostics = getPermissionModeDiagnostics(managed.id)
        managed.previousPermissionMode = diagnostics.previousPermissionMode
        sessionLog.info('Permission mode changed (agent callback)', {
          sessionId: managed.id,
          permissionMode: mode,
          modeVersion: diagnostics.modeVersion,
          changedBy: diagnostics.lastChangedBy,
          changedAt: diagnostics.lastChangedAt,
        })
        this.sendEvent({
          type: 'permission_mode_changed',
          sessionId: managed.id,
          permissionMode: managed.permissionMode,
          modeVersion: diagnostics.modeVersion,
          changedBy: diagnostics.lastChangedBy,
          changedAt: diagnostics.lastChangedAt,
          previousPermissionMode: diagnostics.previousPermissionMode,
          transitionDisplay: diagnostics.transitionDisplay,
        }, managed.workspace.id)
      }

      // Wire up onPlanSubmitted to add plan message to conversation
      managed.agent.onPlanSubmitted = async (planPath) => {
        await this.handlePlanSubmitted(managed, planPath)
      }

      // Wire up onAuthRequest to add auth message to conversation and pause execution
      managed.agent.onAuthRequest = (request) => {
        sessionLog.info(`Auth request for session ${managed.id}:`, request.type, request.sourceSlug)

        // Create auth-request message
        const authMessage: Message = {
          id: generateMessageId(),
          role: 'auth-request',
          content: this.getAuthRequestDescription(request),
          timestamp: this.monotonic(),
          authRequestId: request.requestId,
          authRequestType: request.type,
          authSourceSlug: request.sourceSlug,
          authSourceName: request.sourceName,
          authStatus: 'pending',
          // Copy type-specific fields for credentials
          ...(request.type === 'credential' && {
            authCredentialMode: request.mode,
            authLabels: request.labels,
            authDescription: request.description,
            authHint: request.hint,
            authHeaderName: request.headerName,
            authHeaderNames: request.headerNames,
            authSourceUrl: request.sourceUrl,
            authPasswordRequired: request.passwordRequired,
          }),
        }

        // Add to session messages
        managed.messages.push(authMessage)

        // Store pending auth request for later resolution
        managed.pendingAuthRequestId = request.requestId
        managed.pendingAuthRequest = request

        // Interrupt execution (like SubmitPlan)
        if (managed.isProcessing && managed.agent) {
          sessionLog.info(`Interrupting for auth request in session ${managed.id}`)
          managed.agent.interruptForHandoff(AbortReason.AuthRequest)
          this.setProcessing(managed, false)

          // Release browser overlay + session binding because the agent is paused awaiting user auth.
          void releaseBrowserOwnershipOnForcedStop(this.browserPaneManager, managed.id)

          // Send complete event so renderer knows processing stopped (include tokenUsage for real-time updates)
          this.sendEvent({ type: 'complete', sessionId: managed.id, tokenUsage: managed.tokenUsage }, managed.workspace.id)
        }

        // Emit auth_request event to renderer
        this.sendEvent({
          type: 'auth_request',
          sessionId: managed.id,
          message: authMessage,
          request: request,
        }, managed.workspace.id)

        // Persist session state
        this.persistSession(managed)

        // OAuth flow is client-driven via performOAuth() (preload).
        // The UI calls window.electronAPI.performOAuth() when user clicks "Sign in".
      }

      // Wire up onSpawnSession to create independent sessions from agent tool calls
      managed.agent.onSpawnSession = async (request) => {
        sessionLog.info(`Spawn session request from session ${managed.id}:`, request.name || '(unnamed)')

        const session = await this.createSession(managed.workspace.id, {
          name: request.name,
          llmConnection: request.llmConnection ?? managed.llmConnection,
          model: request.model ?? managed.model,
          enabledSourceSlugs: request.enabledSourceSlugs ?? managed.enabledSourceSlugs,
          permissionMode: request.permissionMode ?? managed.permissionMode,
          thinkingLevel: request.thinkingLevel ?? managed.thinkingLevel,
          labels: request.labels ?? managed.labels,
          workingDirectory: request.workingDirectory,
        })

        // Build FileAttachment[] from paths (if any)
        let fileAttachments: FileAttachment[] | undefined
        if (request.attachments?.length) {
          const attachments: FileAttachment[] = []
          for (const a of request.attachments) {
            try {
              const extraDirs = getWorkspaceAllowedDirs(managed.workspace.id)
              if (request.workingDirectory) extraDirs.push(request.workingDirectory)
              const safePath = await validateFilePath(a.path, extraDirs)
              const attachment = readFileAttachment(safePath)
              if (attachment) {
                if (a.name) attachment.name = a.name
                attachments.push(attachment)
              } else {
                sessionLog.warn(`Spawn session: attachment not found: ${a.path}`)
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              sessionLog.warn(`Spawn session: blocked attachment path ${a.path}: ${message}`)
            }
          }
          if (attachments.length > 0) fileAttachments = attachments
        }

        // Notify renderer to hydrate full session metadata (including name)
        // before streaming events arrive. Without this, the renderer creates
        // a synthetic empty session and shows "New Chat" in the sidebar.
        this.sendEvent({ type: 'session_created', sessionId: session.id }, managed.workspace.id)

        // Fire and forget — send the message but don't await completion
        this.sendMessage(session.id, request.prompt, fileAttachments).catch(err => {
          sessionLog.error(`Failed to send message to spawned session ${session.id}:`, err)
        })

        return {
          sessionId: session.id,
          name: session.name || request.name || session.id,
          status: 'started' as const,
          connection: session.llmConnection,
          model: session.model,
        }
      }

      // Wire up session self-management tools (set_session_labels, set_session_status, etc.)
      mergeSessionScopedToolCallbacks(managed.id, {
        askUserQuestionFn: (request: UserQuestionRequest) => new Promise<UserQuestionResponse>((resolve) => {
          this.pendingUserQuestions.set(request.requestId, {
            sessionId: managed.id,
            resolve,
          })
          this.sendEvent({
            type: 'user_question_request',
            sessionId: managed.id,
            request,
          }, managed.workspace.id)
        }),
        setSessionLabelsFn: async (sessionId: string | undefined, labels: string[]) => {
          await this.setSessionLabels(sessionId ?? managed.id, labels)
        },
        setSessionStatusFn: async (sessionId: string | undefined, status: string) => {
          await this.setSessionStatus(sessionId ?? managed.id, status as SessionStatus)
        },
        getSessionInfoFn: (sessionId?: string) => {
          const targetId = sessionId ?? managed.id
          const session = this.sessions.get(targetId)
          if (!session) return null
          return {
            id: session.id,
            name: session.name ?? session.id,
            labels: session.labels ?? [],
            status: session.sessionStatus ?? 'todo',
            permissionMode: session.permissionMode ?? 'ask',
            createdAt: session.createdAt ?? 0,
            workingDirectory: session.workingDirectory,
            llmConnection: session.llmConnection,
            model: session.model,
            isActive: session.agent != null,
          }
        },
        listSessionsFn: (options) => {
          const DEFAULT_LIMIT = 20
          const MAX_LIMIT = 100
          const limit = Math.min(options?.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
          const offset = options?.offset ?? 0

          let sessions = this.getSessions(managed.workspace.id)

          // Filter
          if (options?.status) {
            sessions = sessions.filter(s => s.sessionStatus === options.status)
          }
          if (options?.label) {
            sessions = sessions.filter(s => s.labels?.includes(options.label!))
          }
          if (options?.search) {
            const needle = options.search.toLowerCase()
            sessions = sessions.filter(s => s.name?.toLowerCase().includes(needle))
          }

          // Sort
          const sortBy = options?.sortBy ?? 'recent'
          if (sortBy === 'recent') {
            sessions.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
          } else if (sortBy === 'name') {
            sessions.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
          } else if (sortBy === 'status') {
            sessions.sort((a, b) => (a.sessionStatus ?? '').localeCompare(b.sessionStatus ?? ''))
          }

          const total = sessions.length

          // Paginate
          const page = sessions.slice(offset, offset + limit)

          return {
            total,
            returned: page.length,
            sessions: page.map(s => ({
              id: s.id,
              name: s.name ?? s.id,
              labels: s.labels ?? [],
              status: s.sessionStatus ?? 'todo',
              createdAt: s.createdAt ?? 0,
            })),
          }
        },
        resolveLabelsFn: (labels: string[]) => {
          const labelConfig = loadLabelConfig(managed.workspace.rootPath)
          return resolveSessionLabels(labels, labelConfig.labels)
        },
        resolveStatusFn: (status: string) => {
          const statusConfig = loadStatusConfig(managed.workspace.rootPath)
          const allStatuses = statusConfig.statuses
          const available = allStatuses.map(s => s.id)

          // Exact ID match
          const byId = allStatuses.find(s => s.id === status)
          if (byId) return { resolved: byId.id, available }
          // Case-insensitive label → ID
          const byLabel = allStatuses.find(s => s.label.toLowerCase() === status.toLowerCase())
          if (byLabel) return { resolved: byLabel.id, available }

          return { resolved: null, available }
        },
        sendAgentMessageFn: async (sessionId: string, message: string, attachments?: Array<{ path: string; name?: string }>) => {
          // Build FileAttachment[] from paths (same pattern as spawn_session)
          let fileAttachments: FileAttachment[] | undefined
          if (attachments?.length) {
            const builtAttachments: FileAttachment[] = []
            for (const a of attachments) {
              try {
                const extraDirs = getWorkspaceAllowedDirs(managed.workspace.id)
                const safePath = await validateFilePath(a.path, extraDirs)
                const attachment = readFileAttachment(safePath)
                if (attachment) {
                  if (a.name) attachment.name = a.name
                  builtAttachments.push(attachment)
                }
              } catch (error) {
                const msg = error instanceof Error ? error.message : String(error)
                sessionLog.warn(`send_agent_message: blocked attachment path ${a.path}: ${msg}`)
              }
            }
            if (builtAttachments.length > 0) fileAttachments = builtAttachments
          }

          await this.sendMessage(sessionId, message, fileAttachments)
        },
        activateSourceInSessionFn: async (sourceSlug: string) => {
          const cb = managed.agent?.onSourceActivationRequest
          if (!cb) {
            return { ok: false, reason: 'Agent has no activation callback wired' }
          }
          const ok = await cb(sourceSlug)
          if (!ok) {
            return {
              ok: false,
              reason: 'Activation failed — source may be unusable (disabled/unauthenticated) or server build failed. Check session logs.',
            }
          }
          return { ok: true, availability: 'next-turn' as const }
        },
      })

      // Wire up onSourceActivationRequest to auto-enable sources when agent tries to use them
      managed.agent.onSourceActivationRequest = async (sourceSlug: string): Promise<boolean> => {
        sessionLog.info(`Source activation request for session ${managed.id}:`, sourceSlug)

        const workspaceRootPath = managed.workspace.rootPath
        const projectRoot = getResourceProjectRoot(managed.workspace)

        // Check if source is already enabled
        if (managed.enabledSourceSlugs?.includes(sourceSlug)) {
          sessionLog.info(`Source ${sourceSlug} already in enabledSourceSlugs, checking server status`)
          // Source is in the list but server might not be active (e.g., build failed previously)
        }

        // Load the source to check if it exists and is ready
        const sources = getSourcesBySlugs(projectRoot, [sourceSlug])
        if (sources.length === 0) {
          sessionLog.warn(`Source ${sourceSlug} not found in workspace`)
          return false
        }

        const source = sources[0]

        // Check if source is usable (enabled and authenticated if auth is required)
        if (!isSourceUsable(source)) {
          sessionLog.warn(`Source ${sourceSlug} is not usable (disabled or requires authentication)`)
          return false
        }

        // Track whether we added this slug (for rollback on failure)
        const slugSet = new Set(managed.enabledSourceSlugs || [])
        const wasAlreadyEnabled = slugSet.has(sourceSlug)

        // Add to enabled sources if not already there
        if (!wasAlreadyEnabled) {
          slugSet.add(sourceSlug)
          managed.enabledSourceSlugs = Array.from(slugSet)
          sessionLog.info(`Added source ${sourceSlug} to session enabled sources`)
        }

        // Build server configs for all enabled sources
        const allEnabledSources = getSourcesBySlugs(projectRoot, managed.enabledSourceSlugs || [])
        // Pass session path so large API responses can be saved to session folder
        const sessionPath = getSessionStoragePath(workspaceRootPath, managed.id)
        const { mcpServers, apiServers, errors } = await buildServersFromSources(allEnabledSources, sessionPath, managed.tokenRefreshManager, managed.agent?.getSummarizeCallback())

        if (errors.length > 0) {
          sessionLog.warn(`Source build errors during auto-enable:`, errors)
        }

        // Check if our target source was built successfully
        const sourceBuilt = sourceSlug in mcpServers || sourceSlug in apiServers
        if (!sourceBuilt) {
          sessionLog.warn(`Source ${sourceSlug} failed to build`)
          // Only remove if WE added it (not if it was already there)
          if (!wasAlreadyEnabled) {
            slugSet.delete(sourceSlug)
            managed.enabledSourceSlugs = Array.from(slugSet)
          }
          return false
        }

        // Apply source servers to the agent
        const intendedSlugs = allEnabledSources
          .filter(isSourceUsable)
          .map(s => s.config.slug)

        // Update source runtime config/credentials for backends that need it
        await applyBridgeUpdates(managed.agent!, sessionPath, allEnabledSources, mcpServers, managed.id, workspaceRootPath, 'source enable')

        await managed.agent!.setSourceServers(mcpServers, apiServers, intendedSlugs)

        sessionLog.info(`Auto-enabled source ${sourceSlug} for session ${managed.id}`)

        // Persist session with updated enabled sources
        this.persistSession(managed)

        // Notify renderer of source change
        this.sendEvent({
          type: 'sources_changed',
          sessionId: managed.id,
          enabledSourceSlugs: managed.enabledSourceSlugs || [],
        }, managed.workspace.id)

        return true
      }

      // NOTE: Source reloading is now handled by ConfigWatcher callbacks
      // which detect filesystem changes and update all affected sessions.
      // See setupConfigWatcher() for the full reload logic.

      // Apply session-scoped permission mode to the newly created agent
      // This ensures the UI toggle state is reflected in the agent before first message
      if (managed.permissionMode) {
        setPermissionMode(managed.id, managed.permissionMode, { changedBy: 'restore' })
        if (managed.previousPermissionMode) {
          hydratePreviousPermissionMode(managed.id, managed.previousPermissionMode)
        }
        managed.agent!.setPermissionMode(managed.permissionMode)
        const diagnostics = getPermissionModeDiagnostics(managed.id)
        sessionLog.info('Applied permission mode to agent', {
          sessionId: managed.id,
          permissionMode: managed.permissionMode,
          modeVersion: diagnostics.modeVersion,
          changedBy: diagnostics.lastChangedBy,
          changedAt: diagnostics.lastChangedAt,
        })
      }
      managed.backendRuntimeSignature = runtimeSignature
      managed.backendRestartSignature = restartSignature
      end()
    }
    return managed.agent
  }

  async flagSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.isFlagged = true
      // Persist in-memory state directly to avoid race with pending queue writes
      this.persistSession(managed)
      await this.flushSession(managed.id)
      // Notify all windows for this workspace
      this.sendEvent({ type: 'session_flagged', sessionId }, managed.workspace.id)
      // Workaround: Bun's fs.watch({ recursive: true }) on Linux doesn't track
      // directories created after the watcher started.
      // https://github.com/oven-sh/bun/issues/15939
      const watcher = this.configWatchers.get(managed.workspace.rootPath)
      watcher?.notifyFileChange(`sessions/${sessionId}/session.jsonl`)
    }
  }

  async unflagSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.isFlagged = false
      // Persist in-memory state directly to avoid race with pending queue writes
      this.persistSession(managed)
      await this.flushSession(managed.id)
      // Notify all windows for this workspace
      this.sendEvent({ type: 'session_unflagged', sessionId }, managed.workspace.id)
      // Workaround: Bun's fs.watch({ recursive: true }) on Linux doesn't track
      // directories created after the watcher started.
      // https://github.com/oven-sh/bun/issues/15939
      const watcher = this.configWatchers.get(managed.workspace.rootPath)
      watcher?.notifyFileChange(`sessions/${sessionId}/session.jsonl`)
    }
  }

  async archiveSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.isArchived = true
      managed.archivedAt = Date.now()
      // Persist in-memory state directly to avoid race with pending queue writes
      this.persistSession(managed)
      await this.flushSession(managed.id)
      // Notify all windows for this workspace
      this.sendEvent({ type: 'session_archived', sessionId }, managed.workspace.id)
      this.emitUnreadSummaryChanged()
    }
  }

  async unarchiveSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.isArchived = false
      managed.archivedAt = undefined
      // Persist in-memory state directly to avoid race with pending queue writes
      this.persistSession(managed)
      await this.flushSession(managed.id)
      // Notify all windows for this workspace
      this.sendEvent({ type: 'session_unarchived', sessionId }, managed.workspace.id)
      this.emitUnreadSummaryChanged()
    }
  }

  async setSessionStatus(sessionId: string, sessionStatus: SessionStatus): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.sessionStatus = sessionStatus
      this.setMetadataWriteGuard(managed)
      // Persist in-memory state directly to avoid race with pending queue writes
      this.persistSession(managed)
      await this.flushSession(managed.id)
      // Notify all windows for this workspace
      this.sendEvent({ type: 'session_status_changed', sessionId, sessionStatus }, managed.workspace.id)
      // Workaround: Bun's fs.watch({ recursive: true }) on Linux doesn't track
      // directories created after the watcher started.
      // https://github.com/oven-sh/bun/issues/15939
      const watcher = this.configWatchers.get(managed.workspace.rootPath)
      watcher?.notifyFileChange(`sessions/${sessionId}/session.jsonl`)
    }
  }

  /**
   * Set the LLM connection for a session.
   * Can only be changed before the first message is sent (connection is locked after).
   * This determines which LLM provider/backend will be used for this session.
   */
  async setSessionConnection(sessionId: string, connectionSlug: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      sessionLog.warn(`setSessionConnection: session ${sessionId} not found`)
      throw new Error(`Session ${sessionId} not found`)
    }

    // Only allow changing connection before first message (session hasn't started)
    if (managed.messages && managed.messages.length > 0) {
      sessionLog.warn(`setSessionConnection: cannot change connection after session has started (${sessionId})`)
      throw new Error('Cannot change connection after session has started')
    }

    // Validate connection exists
    const { getLlmConnection } = await import('@craft-agent/shared/config/storage')
    const connection = getLlmConnection(connectionSlug)
    if (!connection) {
      sessionLog.warn(`setSessionConnection: connection "${connectionSlug}" not found`)
      throw new Error(`LLM connection "${connectionSlug}" not found`)
    }

    managed.llmConnection = connectionSlug
    // Persist in-memory state directly to avoid race with pending queue writes
    this.persistSession(managed)
    await this.flushSession(managed.id)
    sessionLog.info(`Set LLM connection for session ${sessionId} to ${connectionSlug}`)

    // Notify UI that connection changed (triggers capabilities refresh)
    this.sendEvent({
      type: 'connection_changed',
      sessionId,
      connectionSlug,
      supportsBranching: resolveSupportsBranching(managed),
    }, managed.workspace.id)
  }

  // ============================================
  // Pending Plan Execution (Accept & Compact)
  // ============================================

  /**
   * Set pending plan execution state.
   * Called when user clicks "Accept & Compact" to persist the plan path
   * so execution can resume after compaction (even if page reloads).
   */
  async setPendingPlanExecution(sessionId: string, planPath: string, draftInputSnapshot?: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      await setStoredPendingPlanExecution(managed.workspace.rootPath, sessionId, planPath, draftInputSnapshot)
      sessionLog.info(`Session ${sessionId}: set pending plan execution for ${planPath}`)
    }
  }

  /**
   * Mark compaction as complete for pending plan execution.
   * Called when compaction_complete event fires - allows reload recovery
   * to know that compaction finished and plan can be executed.
   */
  async markCompactionComplete(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      await markStoredCompactionComplete(managed.workspace.rootPath, sessionId)
      sessionLog.info(`Session ${sessionId}: compaction marked complete for pending plan`)
    }
  }

  /**
   * Mark pending plan execution as already dispatched from the UI.
   * This prevents reload recovery from double-submitting the same plan if
   * sending succeeded but cleanup failed due a reconnect/disconnect.
   */
  async markPendingPlanExecutionDispatched(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      await markStoredPendingPlanExecutionDispatched(managed.workspace.rootPath, sessionId)
      sessionLog.info(`Session ${sessionId}: marked pending plan execution as dispatched`)
    }
  }

  /**
   * Clear pending plan execution state.
   * Called after plan execution is triggered, on new user message,
   * or when the pending execution is no longer relevant.
   */
  async clearPendingPlanExecution(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      await clearStoredPendingPlanExecution(managed.workspace.rootPath, sessionId)
      sessionLog.info(`Session ${sessionId}: cleared pending plan execution`)
    }
  }

  /**
   * Get pending plan execution state for a session.
   * Used on reload/init to check if we need to resume plan execution.
   */
  getPendingPlanExecution(sessionId: string): { planPath: string; draftInputSnapshot?: string; awaitingCompaction: boolean; executionDispatched: boolean } | null {
    const managed = this.sessions.get(sessionId)
    if (!managed) return null
    return getStoredPendingPlanExecution(managed.workspace.rootPath, sessionId)
  }

  /**
   * Dispatch a plan approval for a session, equivalent to the desktop
   * "Accept plan" button. Switches the session out of Explore mode (safe)
   * into allow-all if needed so the plan can execute without per-tool
   * prompts, then sends the approval message through the normal sendMessage
   * path.
   */
  async acceptPlan(sessionId: string, _planPath?: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      sessionLog.warn(`acceptPlan: session ${sessionId} not found`)
      return
    }

    if (managed.permissionMode === 'safe') {
      this.setSessionPermissionMode(sessionId, 'allow-all')
    }

    await this.sendMessage(sessionId, PLAN_APPROVAL_MESSAGE)
  }

  // ============================================
  // Session Sharing
  // ============================================

  /**
   * Share session to the web viewer
   * Uploads session data and returns shareable URL
   */
  async shareToViewer(sessionId: string): Promise<import('@craft-agent/shared/protocol').ShareResult> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      return { success: false, error: 'Session not found' }
    }

    // Signal async operation start for shimmer effect
    managed.isAsyncOperationOngoing = true
    this.sendEvent({ type: 'async_operation', sessionId, isOngoing: true }, managed.workspace.id)

    try {
      // Load session directly from disk (already in correct format)
      const storedSession = loadStoredSession(managed.workspace.rootPath, sessionId)
      if (!storedSession) {
        return { success: false, error: 'Session file not found' }
      }

      const { VIEWER_URL } = await import('@craft-agent/shared/branding')
      const response = await fetch(`${VIEWER_URL}/s/api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(storedSession)
      })

      if (!response.ok) {
        sessionLog.error(`Share failed with status ${response.status}`)
        if (response.status === 413) {
          return { success: false, error: 'Session file is too large to share' }
        }
        return { success: false, error: 'Failed to upload session' }
      }

      const data = await response.json() as { id: string; url: string }

      // Store shared info in session
      managed.sharedUrl = data.url
      managed.sharedId = data.id
      const workspaceRootPath = managed.workspace.rootPath
      await updateSessionMetadata(workspaceRootPath, sessionId, {
        sharedUrl: data.url,
        sharedId: data.id,
      })

      sessionLog.info(`Session ${sessionId} shared at ${data.url}`)
      // Notify all windows for this workspace
      this.sendEvent({ type: 'session_shared', sessionId, sharedUrl: data.url }, managed.workspace.id)
      return { success: true, url: data.url }
    } catch (error) {
      sessionLog.error('Share error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    } finally {
      // Signal async operation end
      managed.isAsyncOperationOngoing = false
      this.sendEvent({ type: 'async_operation', sessionId, isOngoing: false }, managed.workspace.id)
    }
  }

  /**
   * Update an existing shared session
   * Re-uploads session data to the same URL
   */
  async updateShare(sessionId: string): Promise<import('@craft-agent/shared/protocol').ShareResult> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      return { success: false, error: 'Session not found' }
    }
    if (!managed.sharedId) {
      return { success: false, error: 'Session not shared' }
    }

    // Signal async operation start for shimmer effect
    managed.isAsyncOperationOngoing = true
    this.sendEvent({ type: 'async_operation', sessionId, isOngoing: true }, managed.workspace.id)

    try {
      // Load session directly from disk (already in correct format)
      const storedSession = loadStoredSession(managed.workspace.rootPath, sessionId)
      if (!storedSession) {
        return { success: false, error: 'Session file not found' }
      }

      const { VIEWER_URL } = await import('@craft-agent/shared/branding')
      const response = await fetch(`${VIEWER_URL}/s/api/${managed.sharedId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(storedSession)
      })

      if (!response.ok) {
        sessionLog.error(`Update share failed with status ${response.status}`)
        if (response.status === 413) {
          return { success: false, error: 'Session file is too large to share' }
        }
        return { success: false, error: 'Failed to update shared session' }
      }

      sessionLog.info(`Session ${sessionId} share updated at ${managed.sharedUrl}`)
      return { success: true, url: managed.sharedUrl }
    } catch (error) {
      sessionLog.error('Update share error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    } finally {
      // Signal async operation end
      managed.isAsyncOperationOngoing = false
      this.sendEvent({ type: 'async_operation', sessionId, isOngoing: false }, managed.workspace.id)
    }
  }

  /**
   * Revoke a shared session
   * Deletes from viewer and clears local shared state
   */
  async revokeShare(sessionId: string): Promise<import('@craft-agent/shared/protocol').ShareResult> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      return { success: false, error: 'Session not found' }
    }
    if (!managed.sharedId) {
      return { success: false, error: 'Session not shared' }
    }

    // Signal async operation start for shimmer effect
    managed.isAsyncOperationOngoing = true
    this.sendEvent({ type: 'async_operation', sessionId, isOngoing: true }, managed.workspace.id)

    try {
      const { VIEWER_URL } = await import('@craft-agent/shared/branding')
      const response = await fetch(
        `${VIEWER_URL}/s/api/${managed.sharedId}`,
        { method: 'DELETE' }
      )

      if (!response.ok) {
        sessionLog.error(`Revoke failed with status ${response.status}`)
        return { success: false, error: 'Failed to revoke share' }
      }

      // Clear shared info
      delete managed.sharedUrl
      delete managed.sharedId
      const workspaceRootPath = managed.workspace.rootPath
      await updateSessionMetadata(workspaceRootPath, sessionId, {
        sharedUrl: undefined,
        sharedId: undefined,
      })

      sessionLog.info(`Session ${sessionId} share revoked`)
      // Notify all windows for this workspace
      this.sendEvent({ type: 'session_unshared', sessionId }, managed.workspace.id)
      return { success: true }
    } catch (error) {
      sessionLog.error('Revoke error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    } finally {
      // Signal async operation end
      managed.isAsyncOperationOngoing = false
      this.sendEvent({ type: 'async_operation', sessionId, isOngoing: false }, managed.workspace.id)
    }
  }

  // ============================================
  // Session Sources
  // ============================================

  /**
   * Update session's enabled sources
   * If agent exists, builds and applies servers immediately.
   * Otherwise, servers will be built fresh on next message.
   */
  async setSessionSources(sessionId: string, sourceSlugs: string[]): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    await this.withAgentRuntimeLock(managed, async () => {
      const workspaceRootPath = managed.workspace.rootPath
      const projectRoot = getResourceProjectRoot(managed.workspace)
      sessionLog.info(`Setting sources for session ${sessionId}:`, sourceSlugs)

      // Clean up credential cache for sources being disabled (security)
      const previousSlugs = new Set(managed.enabledSourceSlugs || [])
      const newSlugs = new Set(sourceSlugs)
      const disabledSlugs = [...previousSlugs].filter(prevSlug => !newSlugs.has(prevSlug))
      if (disabledSlugs.length > 0) {
        try {
          await cleanupSourceRuntimeArtifacts(workspaceRootPath, disabledSlugs)
        } catch (err) {
          sessionLog.warn(`Failed to clean up source runtime artifacts: ${err}`)
        }
      }

      managed.enabledSourceSlugs = sourceSlugs

      const agent = managed.agent
      if (agent) {
        const sources = getSourcesBySlugs(projectRoot, sourceSlugs)
        const sessionPath = getSessionStoragePath(workspaceRootPath, sessionId)
        const { mcpServers, apiServers, errors } = await buildServersFromSources(
          sources,
          sessionPath,
          managed.tokenRefreshManager,
          agent.getSummarizeCallback(),
        )
        if (errors.length > 0) sessionLog.warn('Source build errors:', errors)

        const allSources = loadAllSources(projectRoot)
        agent.setAllSources(allSources)
        const usableSources = sources.filter(isSourceUsable)
        const intendedSlugs = usableSources.map(source => source.config.slug)
        await applyBridgeUpdates(agent, sessionPath, usableSources, mcpServers, managed.id, workspaceRootPath, 'source config change')
        await agent.setSourceServers(mcpServers, apiServers, intendedSlugs)

        sessionLog.info(`Applied ${Object.keys(mcpServers).length} MCP + ${Object.keys(apiServers).length} API sources to active agent (${allSources.length} total)`)
      }

      this.persistSession(managed)
      this.sendEvent({
        type: 'sources_changed',
        sessionId,
        enabledSourceSlugs: sourceSlugs,
      }, managed.workspace.id)
      sessionLog.info(`Session ${sessionId} sources updated: ${sourceSlugs.length} sources`)
    })
  }

  /**
   * Get the enabled source slugs for a session
   */
  getSessionSources(sessionId: string): string[] {
    const managed = this.sessions.get(sessionId)
    return managed?.enabledSourceSlugs ?? []
  }

  /** Get the last user-visible final output, including plan-only turns. */
  private getLastFinalOutputMessageId(messages: Message[]): string | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if ((msg.role === 'assistant' && !msg.isIntermediate) || msg.role === 'plan') {
        return msg.id
      }
    }
    return undefined
  }

  /**
   * Set which session the user is actively viewing.
   * Called when user navigates to a session. Used to determine whether to mark
   * new messages as unread - if user is viewing, don't mark unread.
   */
  setActiveViewingSession(sessionId: string | null, workspaceId: string): void {
    if (sessionId) {
      this.activeViewingSession.set(workspaceId, sessionId)
      // When user starts viewing a session that's not processing, clear unread
      const managed = this.sessions.get(sessionId)
      if (managed && !managed.isProcessing && managed.hasUnread) {
        this.markSessionRead(sessionId)
      }
    } else {
      this.activeViewingSession.delete(workspaceId)
    }
  }

  /**
   * Clear active viewing session for a workspace.
   * Called when all windows leave a workspace to ensure read/unread state is correct.
   */
  clearActiveViewingSession(workspaceId: string): void {
    this.activeViewingSession.delete(workspaceId)
  }

  /**
   * Check if a session is currently being viewed by the user
   */
  private isSessionBeingViewed(sessionId: string, workspaceId: string): boolean {
    return this.activeViewingSession.get(workspaceId) === sessionId
  }

  /**
   * Mark a session as read by setting lastReadMessageId and clearing hasUnread.
   * Called when user navigates to a session (and it's not processing).
   */
  async markSessionRead(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed) return

    // Only mark as read if not currently processing
    // (user is viewing but we want to wait for processing to complete)
    if (managed.isProcessing) return

    let needsPersist = false

    // Update lastReadMessageId for legacy/manual unread functionality
    if (managed.messages.length > 0) {
      const lastFinalId = this.getLastFinalOutputMessageId(managed.messages)
      if (lastFinalId && managed.lastReadMessageId !== lastFinalId) {
        managed.lastReadMessageId = lastFinalId
        needsPersist = true
      }
    }

    // Clear hasUnread flag (primary source of truth for NEW badge)
    if (managed.hasUnread) {
      managed.hasUnread = false
      needsPersist = true
    }

    // Persist changes
    if (needsPersist) {
      this.persistSession(managed)
      this.emitUnreadSummaryChanged()
    }
  }

  /**
   * Mark a session as unread by setting hasUnread flag.
   * Called when user manually marks a session as unread via context menu.
   */
  async markSessionUnread(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.hasUnread = true
      managed.lastReadMessageId = undefined
      this.persistSession(managed)
      this.emitUnreadSummaryChanged()
    }
  }

  /**
   * Mark all non-hidden, non-archived sessions in a workspace as read.
   * Called from "Mark All Read" context menu on "All Sessions".
   */
  async markAllSessionsRead(workspaceId: string): Promise<void> {
    let changed = false
    for (const managed of this.sessions.values()) {
      if (managed.workspace.id !== workspaceId) continue
      if (managed.hidden || managed.isArchived) continue
      if (managed.isProcessing) continue
      if (!managed.hasUnread) continue
      managed.hasUnread = false
      this.persistSession(managed)
      changed = true
    }
    if (changed) {
      this.emitUnreadSummaryChanged()
    }
  }

  async renameSession(sessionId: string, name: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.name = name
      this.persistSession(managed)
      // Notify renderer of the name change
      this.sendEvent({ type: 'title_generated', sessionId, title: name }, managed.workspace.id)
      // Workaround: Bun's fs.watch({ recursive: true }) on Linux doesn't track
      // directories created after the watcher started.
      // https://github.com/oven-sh/bun/issues/15939
      const watcher = this.configWatchers.get(managed.workspace.rootPath)
      watcher?.notifyFileChange(`sessions/${sessionId}/session.jsonl`)
    }
  }

  /**
   * Regenerate the session title based on recent messages.
   * Uses the last few user messages to capture what the session has evolved into.
   * Automatically uses the same provider as the session (Claude or OpenAI).
   */
  async refreshTitle(sessionId: string): Promise<{ success: boolean; title?: string; error?: string }> {
    sessionLog.info(`refreshTitle called for session ${sessionId}`)
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      sessionLog.warn(`refreshTitle: Session ${sessionId} not found`)
      return { success: false, error: 'Session not found' }
    }

    // Ensure messages are loaded from disk (lazy loading support)
    await this.ensureMessagesLoaded(managed)

    // Select a spread of user messages (first, middle, last) to capture the session's purpose
    const allUserContents = managed.messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
    const userMessages = selectSpreadMessages(allUserContents)

    sessionLog.info(`refreshTitle: Selected ${userMessages.length} spread messages from ${allUserContents.length} total`)

    if (userMessages.length === 0) {
      sessionLog.warn(`refreshTitle: No user messages found`)
      return { success: false, error: 'No user messages to generate title from' }
    }

    // Get the most recent assistant response
    const lastAssistantMsg = managed.messages
      .filter((m) => m.role === 'assistant' && !m.isIntermediate)
      .slice(-1)[0]

    const assistantResponse = lastAssistantMsg?.content ?? ''

    // Notify renderer that title regeneration has started (for shimmer effect)
    managed.isAsyncOperationOngoing = true
    this.sendEvent({ type: 'async_operation', sessionId, isOngoing: true }, managed.workspace.id)
    // Keep legacy event for backward compatibility
    this.sendEvent({ type: 'title_regenerating', sessionId, isRegenerating: true }, managed.workspace.id)

    try {
      sessionLog.info(`refreshTitle: Calling agent.regenerateTitle...`)
      const title = await this.withAgentRuntimeLease(
        managed,
        async (agent) => {
          const title = await agent.regenerateTitle(userMessages, assistantResponse, { language: getCurrentLanguageName() })
          if (title) {
            managed.name = title
            this.persistSession(managed)
            this.sendEvent({ type: 'title_generated', sessionId, title }, managed.workspace.id)
          } else {
            this.sendEvent({ type: 'title_regenerating', sessionId, isRegenerating: false }, managed.workspace.id)
          }
          return title
        },
      )
      sessionLog.info(`refreshTitle: regenerateTitle returned: ${title ? `"${title}"` : 'null'}`)
      if (title) {
        sessionLog.info(`Refreshed title for session ${sessionId}: "${title}"`)
        return { success: true, title }
      }
      return { success: false, error: 'Failed to generate title' }
    } catch (error) {
      // Error occurred - clear regenerating state
      if (this.sessions.get(sessionId) === managed && managed.runtimeState !== 'deleting') {
        this.sendEvent({ type: 'title_regenerating', sessionId, isRegenerating: false }, managed.workspace.id)
      }
      const message = error instanceof Error ? error.message : 'Unknown error'
      sessionLog.error(`Failed to refresh title for session ${sessionId}:`, error)
      return { success: false, error: message }
    } finally {
      // Signal async operation end
      managed.isAsyncOperationOngoing = false
      if (this.sessions.get(sessionId) === managed && managed.runtimeState !== 'deleting') {
        this.sendEvent({ type: 'async_operation', sessionId, isOngoing: false }, managed.workspace.id)
      }
    }
  }

  /**
   * Update the working directory for a session.
   * Pi binds cwd when AgentSession is created, so changing it after the
   * conversation starts would split tool execution from rendered file links.
   */
  updateWorkingDirectory(sessionId: string, path: string): void {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      if (isFreeConversationWorkspaceId(managed.workspace.id)) {
        sessionLog.warn(`Session ${sessionId}: rejected working directory change in Free Conversations`)
        this.sendEvent({
          type: 'working_directory_error',
          sessionId,
          error: 'Free Conversations use a private session directory',
        }, managed.workspace.id)
        return
      }

      const runCwdBound = managed.messages.length > 0 || !!managed.sdkSessionId || !!managed.agent
      if (runCwdBound) {
        sessionLog.warn(`Session ${sessionId}: rejected working directory change after Pi cwd was bound`)
        this.sendEvent({
          type: 'working_directory_error',
          sessionId,
          error: 'This conversation has already started. Create a new conversation to use a different working directory.',
        }, managed.workspace.id)
        return
      }

      const validation = isValidWorkingDirectory(path)
      if (!validation.valid) {
        sessionLog.warn(`Session ${sessionId}: rejected working directory "${path}" — ${validation.reason}`)
        this.sendEvent({
          type: 'working_directory_error',
          sessionId,
          error: validation.reason!,
        }, managed.workspace.id)
        return
      }

      managed.workingDirectory = path
      // Read-compatible legacy field. Pi persistence is isolated by the explicit
      // PiSessionManager path; new runtime behavior uses workingDirectory as cwd.
      managed.sdkCwd = path

      // Invalidate filesystem caches that depend on working directory
      invalidateContextFileCache(path)
      invalidateSkillsCache()

      this.persistSession(managed)
      // Notify renderer of the working directory change
      this.sendEvent({ type: 'working_directory_changed', sessionId, workingDirectory: path }, managed.workspace.id)
    }
  }

  /**
   * Update the model for a session
   * Pass null to clear the session-specific model (will use global config)
   * @param connection - Optional LLM connection slug. Locked sessions may only
   * switch between transports in the app-managed model catalog.
   */
  async updateSessionModel(sessionId: string, workspaceId: string, model: string | null, connection?: string): Promise<void> {
    sessionLog.info(`[updateSessionModel] sessionId=${sessionId}, model=${model}, connection=${connection}`)
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.model = model ?? undefined
      const connectionChanged = !!connection
        && connection !== managed.llmConnection
        && canSwitchSessionModelConnection(!!managed.connectionLocked, managed.llmConnection, connection)
      const shouldUpdateConnection = !!connection && (
        connection === managed.llmConnection || connectionChanged
      )
      if (shouldUpdateConnection) {
        managed.llmConnection = connection
      }
      const updates: { model?: string; llmConnection?: string } = { model: model ?? undefined }
      if (shouldUpdateConnection) {
        updates.llmConnection = connection
      }
      await updateSessionMetadata(managed.workspace.rootPath, sessionId, updates)
      // A protocol change is refreshed by getOrCreateAgent after auth is
      // reinitialized. Do not transiently apply the new model to the old runtime.
      if (managed.agent && !connectionChanged) {
        // Fallback chain: session model > workspace default > connection default
        const wsConfig = loadWorkspaceConfig(managed.workspace.rootPath)
        const sessionConn = resolveSessionConnection(managed.llmConnection, wsConfig?.defaults?.defaultLlmConnection)
        const effectiveModel = model ?? wsConfig?.defaults?.model ?? sessionConn?.defaultModel!
        sessionLog.info(`[updateSessionModel] Calling agent.setModel(${effectiveModel}) [agent exists=${!!managed.agent}, connectionLocked=${managed.connectionLocked}]`)
        managed.agent.setModel(effectiveModel)
      } else {
        sessionLog.info(`[updateSessionModel] Model and connection will apply on next agent resolution`)
      }
      // Notify renderer of the model change
      this.sendEvent({ type: 'session_model_changed', sessionId, model }, managed.workspace.id)
      if (connectionChanged) {
        this.sendEvent({
          type: 'connection_changed',
          sessionId,
          connectionSlug: connection!,
          supportsBranching: resolveSupportsBranching(managed),
        }, managed.workspace.id)
      }
      sessionLog.info(`Session ${sessionId} model updated to: ${model ?? '(global config)'}`)
    }
  }

  /**
   * Update the content of a specific message in a session
   * Used by preview window to save edited content back to the original message
   */
  updateMessageContent(sessionId: string, messageId: string, content: string): void {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      sessionLog.warn(`Cannot update message: session ${sessionId} not found`)
      return
    }

    const message = managed.messages.find(m => m.id === messageId)
    if (!message) {
      sessionLog.warn(`Cannot update message: message ${messageId} not found in session ${sessionId}`)
      return
    }

    // Update the message content
    message.content = content
    // Persist the updated session
    this.persistSession(managed)
    sessionLog.info(`Updated message ${messageId} content in session ${sessionId}`)
  }

  /**
   * Add an annotation to a message and persist the session.
   */
  addMessageAnnotation(sessionId: string, messageId: string, annotation: NonNullable<Message['annotations']>[number]): void {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      sessionLog.warn(`Cannot add annotation: session ${sessionId} not found`)
      return
    }

    const message = managed.messages.find(m => m.id === messageId)
    if (!message) {
      sessionLog.warn(`Cannot add annotation: message ${messageId} not found in session ${sessionId}`)
      return
    }

    if (!annotation?.id || !annotation?.target?.selectors?.length) {
      sessionLog.warn(`Cannot add annotation: invalid annotation payload for message ${messageId}`)
      return
    }

    if (annotation.target.source.messageId !== messageId) {
      sessionLog.warn(`Cannot add annotation: target source.messageId mismatch (${annotation.target.source.messageId} !== ${messageId})`)
      return
    }

    const safeAnnotation: NonNullable<Message['annotations']>[number] = {
      ...annotation,
      schemaVersion: 1,
      target: {
        ...annotation.target,
        source: {
          ...annotation.target.source,
          sessionId,
          messageId,
        },
      },
    }

    const annotationBytes = Buffer.byteLength(JSON.stringify(safeAnnotation), 'utf8')
    if (annotationBytes > MAX_ANNOTATION_JSON_BYTES) {
      sessionLog.warn(`Cannot add annotation: payload too large (${annotationBytes} bytes > ${MAX_ANNOTATION_JSON_BYTES}) on message ${messageId}`)
      return
    }

    const existing = message.annotations ?? []
    if (existing.some(a => a.id === safeAnnotation.id)) {
      sessionLog.warn(`Cannot add annotation: duplicate annotation id ${safeAnnotation.id} on message ${messageId}`)
      return
    }

    if (existing.length >= MAX_ANNOTATIONS_PER_MESSAGE) {
      sessionLog.warn(`Cannot add annotation: per-message limit reached (${MAX_ANNOTATIONS_PER_MESSAGE}) on message ${messageId}`)
      return
    }

    message.annotations = [...existing, safeAnnotation]
    this.persistSession(managed)
    this.sendEvent({ type: 'message_annotations_updated', sessionId, messageId, annotations: message.annotations }, managed.workspace.id)
  }

  /**
   * Patch an existing annotation on a message.
   */
  updateMessageAnnotation(
    sessionId: string,
    messageId: string,
    annotationId: string,
    patch: Partial<NonNullable<Message['annotations']>[number]>
  ): void {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      sessionLog.warn(`Cannot update annotation: session ${sessionId} not found`)
      return
    }

    const message = managed.messages.find(m => m.id === messageId)
    if (!message) {
      sessionLog.warn(`Cannot update annotation: message ${messageId} not found in session ${sessionId}`)
      return
    }

    const existing = message.annotations ?? []
    const idx = existing.findIndex(a => a.id === annotationId)
    if (idx === -1) {
      sessionLog.warn(`Cannot update annotation: annotation ${annotationId} not found on message ${messageId}`)
      return
    }

    if (patch.target?.source?.messageId && patch.target.source.messageId !== messageId) {
      sessionLog.warn(`Cannot update annotation: target source.messageId mismatch in patch (${patch.target.source.messageId} !== ${messageId})`)
      return
    }

    if (patch.target?.selectors && patch.target.selectors.length === 0) {
      sessionLog.warn(`Cannot update annotation: empty selectors patch for annotation ${annotationId} on message ${messageId}`)
      return
    }

    const current = existing[idx]!
    const updated = {
      ...current,
      ...patch,
      id: current.id,
      schemaVersion: current.schemaVersion,
      target: patch.target
        ? {
            ...current.target,
            ...patch.target,
            source: {
              ...current.target.source,
              ...(patch.target.source ?? {}),
              sessionId,
              messageId,
            },
          }
        : {
            ...current.target,
            source: {
              ...current.target.source,
              sessionId,
              messageId,
            },
          },
      updatedAt: Date.now(),
    }

    const updatedBytes = Buffer.byteLength(JSON.stringify(updated), 'utf8')
    if (updatedBytes > MAX_ANNOTATION_JSON_BYTES) {
      sessionLog.warn(`Cannot update annotation: payload too large (${updatedBytes} bytes > ${MAX_ANNOTATION_JSON_BYTES}) for annotation ${annotationId} on message ${messageId}`)
      return
    }

    const next = [...existing]
    next[idx] = updated
    message.annotations = next
    this.persistSession(managed)
    this.sendEvent({ type: 'message_annotations_updated', sessionId, messageId, annotations: message.annotations }, managed.workspace.id)
  }

  /**
   * Remove an annotation from a message and persist the session.
   */
  removeMessageAnnotation(sessionId: string, messageId: string, annotationId: string): void {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      sessionLog.warn(`Cannot remove annotation: session ${sessionId} not found`)
      return
    }

    const message = managed.messages.find(m => m.id === messageId)
    if (!message) {
      sessionLog.warn(`Cannot remove annotation: message ${messageId} not found in session ${sessionId}`)
      return
    }

    const existing = message.annotations ?? []
    if (!existing.some(a => a.id === annotationId)) {
      sessionLog.warn(`Cannot remove annotation: annotation ${annotationId} not found on message ${messageId}`)
      return
    }

    message.annotations = existing.filter(a => a.id !== annotationId)
    this.persistSession(managed)
    this.sendEvent({ type: 'message_annotations_updated', sessionId, messageId, annotations: message.annotations }, managed.workspace.id)
  }

  async deleteSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      sessionLog.warn(`Cannot delete session: ${sessionId} not found`)
      return
    }
    if (managed.runtimeState === 'deleting') return

    // Tombstone synchronously so queued title/query work cannot recreate or
    // persist this session while deletion waits for the active runtime lease.
    managed.runtimeState = 'deleting'
    managed.runtimeEpoch = (managed.runtimeEpoch ?? 0) + 1

    // Get workspace slug before deleting
    const workspaceRootPath = managed.workspace.rootPath

    // If processing is in progress, force-abort via Query.close() and wait for cleanup
    if (managed.isProcessing && managed.agent) {
      managed.agent.forceAbort(AbortReason.UserStop)
      // Brief wait for the query to finish tearing down before we delete session files.
      // Prevents file corruption from overlapping writes during rapid delete operations.
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    // Revoke share if session was shared (prevent orphaned viewer copies)
    if (managed.sharedId) {
      try {
        const { VIEWER_URL } = await import('@craft-agent/shared/branding')
        const response = await fetch(
          `${VIEWER_URL}/s/api/${managed.sharedId}`,
          { method: 'DELETE', signal: AbortSignal.timeout(5000) }
        )
        if (!response.ok) {
          sessionLog.warn(`Failed to revoke share for ${sessionId}: HTTP ${response.status}`)
        } else {
          sessionLog.info(`Revoked share for deleted session ${sessionId}`)
        }
      } catch (error) {
        sessionLog.warn(`Failed to revoke share for ${sessionId}:`, error)
      }
    }

    // Clean up delta flush timers to prevent orphaned timers
    const timer = this.deltaFlushTimers.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      this.deltaFlushTimers.delete(sessionId)
    }
    this.pendingDeltas.delete(sessionId)
    this.clearAdminRememberApprovalsForSession(sessionId)
    this.clearPendingPermissionRequestsForSession(sessionId)
    this.cancelPendingUserQuestionsForSession(sessionId)

    // Cancel any pending persistence write (session is being deleted, no need to save)
    sessionPersistenceQueue.cancel(sessionId)

    // Clean up session-scoped tool callbacks to prevent memory accumulation
    unregisterSessionScopedToolCallbacks(sessionId)

    // Destroy browser instances bound to this session
    if (this.browserPaneManager) {
      this.browserPaneManager.destroyForSession(sessionId)
    }

    // Dispose only after any model-free runtime transaction (for example rewind) settles.
    await this.withAgentRuntimeLock(
      managed,
      () => this.disposeManagedAgentRuntime(managed, 'session deletion'),
      true,
    )

    // A send that linearized before the tombstone may have queued a final
    // debounced snapshot while deletion waited for its operation lease.
    sessionPersistenceQueue.cancel(sessionId)
    await sessionPersistenceQueue.flush(sessionId)

    this.sessions.delete(sessionId)

    // Clean up session metadata in AutomationSystem (prevents memory leak)
    const automationSystem = this.automationSystems.get(workspaceRootPath)
    if (automationSystem) {
      automationSystem.removeSessionMetadata(sessionId)
    }

    // Delete from disk too
    deleteStoredSession(workspaceRootPath, sessionId)

    // Notify all windows for this workspace that the session was deleted
    this.sendEvent({ type: 'session_deleted', sessionId }, managed.workspace.id)
    this.emitUnreadSummaryChanged()

    // Clean up attachments directory (handled by deleteStoredSession for workspace-scoped storage)
    sessionLog.info(`Deleted session ${sessionId}`)
  }

  async queryOnce(sessionId: string, request: OneShotLlmRequest): Promise<OneShotLlmResult> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      throw new Error(`Session ${sessionId} not found`)
    }

    try {
      return await this.withAgentRuntimeLease(managed, agent => agent.queryLlm(request))
    } catch (error) {
      const connectionSlug = resolveManagedConnectionSlug(managed)
      const errorText = error instanceof Error ? error.message : String(error)
      const isManagedAuthError = isManagedDefaultGatewayConnection(connectionSlug)
        && (
          errorText.toLowerCase().includes('invalid model access token')
          || errorText.toLowerCase().includes('model_access_token_invalid')
        )
      if (!isManagedAuthError) throw error

      await this.refreshManagedCredentialForNextTurn(managed)
      sessionLog.warn('[queryOnce] managed auth failed; automatic replay is disabled', {
        sessionId,
        error: errorText,
      })
      throw error
    }
  }

  async rewriteNovelSelection(sessionId: string, request: NovelSelectionRewriteRequest): Promise<NovelSelectionRewriteResult> {
    const prompt = buildNovelSelectionRewritePrompt(request)
    const result = await this.queryOnce(sessionId, {
      prompt,
      temperature: 0.2,
      maxTokens: 4096,
    })

    return {
      replacement: sanitizeNovelSelectionReplacement(result.text),
    }
  }

  async sendMessage(
    sessionId: string,
    message: string,
    attachments?: FileAttachment[],
    storedAttachments?: StoredAttachment[],
    options?: SendMessageOptions,
    existingMessageId?: string,
    /**
     * Internal hook fired after the user message has been pushed to
     * `managed.messages` and persisted to disk, but before the model-streaming
     * work begins. The RPC handler uses this to send a synchronous "accepted"
     * ack to the client so a crash mid-stream doesn't lose the user message
     * (#616). Pre-persist errors still reject the outer promise as before.
     */
    onAck?: (messageId: string) => void,
  ): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const acceptSpan = perf.span('session.sendMessage.accept', {
      sessionId,
      queuedAtEntry: managed.isProcessing,
      attachmentCount: attachments?.length ?? 0,
      storedAttachmentCount: storedAttachments?.length ?? 0,
      hiddenUserMessage: options?.hideUserMessage === true,
      hasOneTimeContext: !!(options?.oneTimeContext?.trim() || options?.workspaceFreshnessContext?.trim()),
      existingMessage: !!existingMessageId,
    })
    let acceptSpanEnded = false
    const ackAccepted = (messageId: string, status: 'accepted' | 'queued' | 'hidden'): void => {
      acceptSpan.setMetadata('status', status)
      acceptSpan.setMetadata('messageCount', managed.messages.length)
      acceptSpan.mark('ack')
      acceptSpan.end()
      acceptSpanEnded = true
      onAck?.(messageId)
    }

    const releaseSessionOperation = this.beginSessionOperationLease(managed)
    try {

    // Clear any pending plan execution state when a new user message is sent.
    // This acts as a safety valve - if the user moves on, we don't want to
    // auto-execute an old plan later.
    await clearStoredPendingPlanExecution(managed.workspace.rootPath, sessionId)
    acceptSpan.mark('pendingPlan.cleared')

    // Ensure messages are loaded before we try to add new ones
    await this.ensureMessagesLoaded(managed)
    acceptSpan.mark('messages.loaded')
    if (managed.rewindCommitInProgress) {
      acceptSpan.setMetadata('status', 'rewind-commit-in-progress')
      acceptSpan.end()
      acceptSpanEnded = true
      throw new Error('Conversation rewind is committing; retry this message')
    }

    const hideUserMessage = options?.hideUserMessage === true

    // If currently processing, an ordinary send is only queued. The active
    // turn continues to natural completion; explicit interruption is reserved
    // for sendQueuedMessageNow().
    if (managed.isProcessing) {
      sessionLog.info('mid-stream send', {
        sessionId,
        behavior: 'queue',
        queueLengthBefore: managed.messageQueue.length,
        backend: managed.agent ? managed.agent.constructor.name : 'none',
      })

      const queuedMessageId = options?.optimisticMessageId ?? generateMessageId()
      const userMessage: Message | undefined = hideUserMessage ? undefined : {
        id: queuedMessageId,
        role: 'user',
        content: message,
        timestamp: this.monotonic(),
        attachments: storedAttachments,
        badges: options?.badges,
        isQueued: true,
        queuedWorkspaceFreshnessContext: options?.workspaceFreshnessContext,
      }

      if (!hideUserMessage && userMessage) {
        managed.messages.push(userMessage)

        this.sendEvent({
          type: 'user_message',
          sessionId,
          message: userMessage,
          status: 'queued',
          optimisticMessageId: options?.optimisticMessageId
        }, managed.workspace.id)
      }

      managed.messageQueue.push({ message, attachments, storedAttachments, options, messageId: userMessage?.id, optimisticMessageId: options?.optimisticMessageId })

      this.persistSession(managed)
      // Force a synchronous flush so the user message is genuinely on disk
      // before we tell the renderer "accepted" — `persistSession` only
      // enqueues with a 500ms debounce. (#616 reliability fix.)
      await this.flushSession(managed.id)
      acceptSpan.mark('session.flushed')
      ackAccepted(userMessage?.id ?? generateMessageId(), 'queued')
      return
    }

    // Add user message with stored attachments for persistence
    // Skip if existingMessageId is provided (message was already created when queued)
    let userMessage: Message | undefined
    let initialTitle: string | undefined
    let titleMessageToGenerate: string | undefined
    if (existingMessageId) {
      // Find existing message (already added when queued)
      userMessage = managed.messages.find(m => m.id === existingMessageId)!
      if (!userMessage) {
        throw new Error(`Existing message ${existingMessageId} not found`)
      }
    } else if (!hideUserMessage) {
      // Prefer the renderer's optimistic id so UI and persisted transcript share one key.
      // (Queued path already does this; diverging here broke rewind on live messages.)
      userMessage = {
        id: options?.optimisticMessageId || generateMessageId(),
        role: 'user',
        content: message,
        timestamp: this.monotonic(),
        attachments: storedAttachments, // Include for persistence (has thumbnailBase64)
        badges: options?.badges,  // Include content badges (sources, skills with embedded icons)
      }
      managed.messages.push(userMessage)

      // Update lastMessageRole for badge display
      managed.lastMessageRole = 'user'

      // Compute the deterministic first title before the durability flush so the
      // accepted message and its initial session metadata become authoritative
      // in one write. Renderer events still follow the accepted ack below.
      const isFirstUserMessage = managed.messages.filter(m => m.role === 'user').length === 1
      if (isFirstUserMessage && !managed.name && !managed.triggeredBy) {
        // Replace bracket mentions with their display labels (e.g. [skill:ws:commit] -> "Commit")
        // so titles show human-readable names instead of raw IDs
        let titleSource = message
        if (options?.badges) {
          for (const badge of options.badges) {
            if (badge.rawText && badge.label) {
              titleSource = titleSource.replace(badge.rawText, badge.label)
            }
          }
        }
        // Sanitize: strip any remaining bracket mentions, XML blocks, tags
        const sanitized = sanitizeForTitle(titleSource)
        initialTitle = sanitized.slice(0, 50) + (sanitized.length > 50 ? '…' : '')
        managed.name = initialTitle
      }

      // Persist + flush before announcing — the user message must be
      // genuinely on disk before we tell the renderer "accepted", and
      // `persistSession` is debounced (500ms). #616.
      this.persistSession(managed)
      await this.flushSession(managed.id)
      acceptSpan.mark('session.flushed')
      ackAccepted(userMessage.id, 'accepted')

      // Emit user_message event so UI can confirm the optimistic message
      this.sendEvent({
        type: 'user_message',
        sessionId,
        message: userMessage,
        status: 'accepted',
        optimisticMessageId: options?.optimisticMessageId
      }, managed.workspace.id)

      // AI generation will enhance the initial title later, but greetings and
      // acknowledgements keep the deterministic title to avoid a cold-path call.
      if (initialTitle !== undefined) {
        this.sendEvent({
          type: 'title_generated',
          sessionId,
          title: initialTitle,
        }, managed.workspace.id)

        if (!isLowSignal(message)) titleMessageToGenerate = message
      }
    } else {
      ackAccepted(generateMessageId(), 'hidden')
    }

    if (!acceptSpanEnded) {
      acceptSpan.setMetadata('status', 'continued')
      acceptSpan.end()
      acceptSpanEnded = true
    }

    // Evaluate auto-label rules against the user message (common path for both
    // fresh and queued messages). Scans regex patterns configured on labels,
    // then merges any new matches into the session's label array.
    if (!hideUserMessage) try {
      const labelTree = listLabels(managed.workspace.rootPath)
      const autoMatches = evaluateAutoLabels(message, labelTree)

      if (autoMatches.length > 0) {
        const existingLabels = managed.labels ?? []
        const newEntries = autoMatches
          .map(m => `${m.labelId}::${m.value}`)
          .filter(entry => !existingLabels.includes(entry))

        if (newEntries.length > 0) {
          managed.labels = [...existingLabels, ...newEntries]
          this.persistSession(managed)
          this.sendEvent({
            type: 'labels_changed',
            sessionId,
            labels: managed.labels,
          }, managed.workspace.id)
        }
      }
    } catch (e) {
      sessionLog.warn(`Auto-label evaluation failed for session ${sessionId}:`, e)
    }

    managed.lastMessageAt = Date.now()
    managed.turnStartedAt = userMessage?.timestamp ?? Date.now()
    this.setProcessing(managed, true)
    managed.streamingText = ''
    managed.processingGeneration++
    managed.turnStartFinalMessageId = this.getLastFinalOutputMessageId(managed.messages)

    // Capture the generation to detect if a new request supersedes this one.
    // This prevents the finally block from clobbering state when a follow-up message arrives.
    const myGeneration = managed.processingGeneration
    const turnWatchdog = new TurnWatchdog({
      hardTimeoutMs: SESSION_TURN_HARD_TIMEOUT_MS,
      onTimeout: timeout => this.handleTurnWatchdogTimeout(sessionId, myGeneration, timeout),
    })
    turnWatchdog.start()

    // Pre-enable sources required by invoked skills (Issue #249)
    // This eliminates the two-turn penalty where the agent discovers missing sources at runtime.
    // Load only the invoked Skill instead of scanning every definition.
    if (options?.skillSlugs?.length) {
      try {
        const projectRoot = getResourceProjectRoot(managed.workspace)
        const skillCwd = managed.workingDirectory ?? projectRoot
        const requiredSources = new Set<string>()
        const { skills } = await loadPiSkillCatalog(skillCwd)
        const skillsBySlug = new Map(skills.map(skill => [skill.slug, skill]))
        for (const slug of options.skillSlugs) {
          const skill = skillsBySlug.get(slug)
          if (skill?.metadata.requiredSources) {
            for (const src of skill.metadata.requiredSources) {
              requiredSources.add(src)
            }
          }
        }

        if (requiredSources.size > 0) {
          const currentSlugs = new Set(managed.enabledSourceSlugs || [])
          const toEnable: string[] = []
          const skipped: string[] = []
          const candidateSlugs = Array.from(requiredSources)
          const loadedSources = getSourcesBySlugs(projectRoot, candidateSlugs)
          const usableSources = new Set(
            loadedSources
              .filter(isSourceUsable)
              .map(source => source.config.slug)
          )

          for (const srcSlug of candidateSlugs) {
            if (currentSlugs.has(srcSlug)) continue
            if (usableSources.has(srcSlug)) {
              toEnable.push(srcSlug)
            } else {
              skipped.push(srcSlug)
            }
          }

          if (skipped.length > 0) {
            sessionLog.warn(`Skill requires sources that are not usable (missing or unauthenticated): ${skipped.join(', ')}`)
          }

          if (toEnable.length > 0) {
            managed.enabledSourceSlugs = [...(managed.enabledSourceSlugs || []), ...toEnable]
            sessionLog.info(`Pre-enabled sources for skill invocation: ${toEnable.join(', ')}`)
            this.persistSession(managed)
            this.sendEvent({
              type: 'sources_changed',
              sessionId,
              enabledSourceSlugs: managed.enabledSourceSlugs,
            }, managed.workspace.id)
          }
        }
      } catch (e) {
        sessionLog.warn(`Failed to pre-enable skill sources for session ${sessionId}:`, e)
      }
    }

    // Start perf span for entire sendMessage flow
    const sendSpan = perf.span('session.sendMessage', { sessionId })

    try {
    const workspaceRootPath = managed.workspace.rootPath
    const projectRoot = getResourceProjectRoot(managed.workspace)
    const enabledSlugs = managed.enabledSourceSlugs ?? []
    const hasSources = enabledSlugs.length > 0

    // Load enabled sources up-front so we can refresh tokens BEFORE the runtime lease
    // runs its internal cold-session build. Otherwise that build sees stale tokens
    // and emits AUTH_REQUIRED, causing a brief "needs_auth" UI flicker before the
    // post-build refresh restores state (#710).
    const sources: LoadedSource[] = hasSources
      ? getSourcesBySlugs(projectRoot, enabledSlugs)
      : []

    if (hasSources && managed.tokenRefreshManager) {
      const refreshResult = await refreshExpiredCredentials(sources, managed.tokenRefreshManager)
      if (refreshResult.failedSources.length > 0) {
        sessionLog.warn('[OAuth] Some sources failed token refresh:', refreshResult.failedSources.map(f => f.slug))
      }
      if (refreshResult.refreshedCount > 0) {
        sendSpan.mark('oauth.refreshed')
      }
    }

    releaseSessionOperation()

    // Claim the agent for the full source-setup and chat lifecycle. Its cold-session build at
    // ~L2956 now sees fresh tokens (or correctly-needs_auth failed sources, since
    // ensureFreshToken mirrors the disk write to source.config in-memory).
    await this.withAgentRuntimeLease(managed, async agent => {
    sendSpan.mark('agent.facade.ready')

    // Always set all sources for context (even if none are enabled), including built-ins
    const allSources = loadAllSources(projectRoot)
    agent.setAllSources(allSources)
    sendSpan.mark('sources.loaded')

    // Apply source servers if any are enabled
    if (hasSources) {
      const sessionPath = getSessionStoragePath(workspaceRootPath, sessionId)
      // Single fresh build — tokens already refreshed above.
      const { mcpServers, apiServers, errors } = await buildServersFromSources(sources, sessionPath, managed.tokenRefreshManager, agent.getSummarizeCallback())
      if (errors.length > 0) {
        sessionLog.warn(`Source build errors:`, errors)
      }

      const mcpCount = Object.keys(mcpServers).length
      const apiCount = Object.keys(apiServers).length
      if (mcpCount > 0 || apiCount > 0 || enabledSlugs.length > 0) {
        const usableSources = sources.filter(isSourceUsable)
        const intendedSlugs = usableSources.map(s => s.config.slug)
        await agent.setSourceServers(mcpServers, apiServers, intendedSlugs)
        await applyBridgeUpdates(agent, sessionPath, usableSources, mcpServers, sessionId, workspaceRootPath, 'send message')
        sessionLog.info(`Applied ${mcpCount} MCP + ${apiCount} API sources to session ${sessionId} (${allSources.length} total)`)
      }
      sendSpan.mark('servers.applied')
    }

      sessionLog.info('Starting chat', {
        sessionId,
        workspaceId: managed.workspace.id,
        messageLength: message.length,
        attachmentCount: attachments?.length ?? 0,
        storedAttachmentCount: storedAttachments?.length ?? 0,
        model: agent.getModel(),
      })

      // Process the message through the agent
      sessionLog.info('Calling agent.chat()...')
      if (attachments?.length) {
        sessionLog.info('Attachments:', attachments.length)
      }

      const transientPolicies: string[] = []
      if (managed.wasInterrupted) {
        transientPolicies.push('The previous assistant response was interrupted by the user and may be incomplete. Do not repeat or continue the interrupted response unless asked. Focus on the new request.')
        managed.wasInterrupted = false
      }
      if (options?.workspaceFreshnessContext?.trim()) {
        transientPolicies.push('Files listed in <workspace-brief> changed outside this conversation. Before editing any listed file, read its latest content first.')
      }

      const messageBackendContext = resolveBackendContext({
        sessionConnectionSlug: managed.llmConnection,
        workspaceDefaultConnectionSlug: loadWorkspaceConfig(workspaceRootPath)?.defaults?.defaultLlmConnection,
        managedModel: managed.model,
      })
      const modelInputAttachments = filterAttachmentsForModelInput(
        attachments,
        messageBackendContext.connection,
        messageBackendContext.resolvedModel,
      )
      if (modelInputAttachments.omittedImages.length > 0) {
        const omittedNames = modelInputAttachments.omittedImages.map(a => a.name).join(', ')
        sessionLog.info(`Omitting ${modelInputAttachments.omittedImages.length} image attachment(s) from model input for ${messageBackendContext.resolvedModel}: ${omittedNames}`)
        this.sendEvent({
          type: 'info',
          sessionId,
          message: `Image attachment${modelInputAttachments.omittedImages.length === 1 ? '' : 's'} not sent because image input is disabled for ${messageBackendContext.resolvedModel}.`,
          level: 'warning',
        }, managed.workspace.id)
      }

      sendSpan.mark('chat.starting')
      const userIteration = managed.messages.filter(message => message.role === 'user').length
      const productUserIndex = userMessage
        ? managed.messages.findIndex(entry => entry.id === userMessage.id)
        : -1
      const hasPriorUserMessage = productUserIndex > 0 && managed.messages
        .slice(0, productUserIndex)
        .some(entry => entry.role === 'user')
      const precedingPersistedMessageId = [...managed.messages.slice(0, productUserIndex)]
        .reverse()
        .find(entry => entry.role !== 'status')?.id ?? null
      const rewindBoundary = {
        ...(userMessage ? { visibleUserMessageId: userMessage.id } : {}),
        retainThroughMessageId: userMessage
          ? (hasPriorUserMessage ? precedingPersistedMessageId : null)
          : ([...managed.messages].reverse().find(entry => entry.role !== 'status')?.id ?? null),
        ...(userMessage ? { draftText: message } : {}),
      }
      const chatIterator = agent.chat(message, modelInputAttachments.attachments, {
        oneTimeContext: [options?.oneTimeContext, options?.workspaceFreshnessContext]
          .map(context => context?.trim())
          .filter(Boolean)
          .join('\n\n') || undefined,
        turnPolicy: transientPolicies.join('\n\n') || undefined,
        userIteration,
        rewindBoundary,
      })
      sessionLog.info('Got chat iterator, starting iteration...')

      let hasMarkedFirstAgentEvent = false
      for await (const event of chatIterator) {
        if (!hasMarkedFirstAgentEvent) {
          sendSpan.mark('agent.first_event')
          hasMarkedFirstAgentEvent = true
        }
        if (turnWatchdog.getTimeout()) {
          sessionLog.info('Dropping agent event after turn watchdog timeout', { sessionId, eventType: event.type })
          break
        }
        if (managed.processingGeneration !== myGeneration) {
          sessionLog.info('Dropping stale agent event after newer generation started', { sessionId, eventType: event.type })
          break
        }
        // Log events (skip noisy text_delta)
        if (event.type !== 'text_delta') {
          if (event.type === 'tool_start') {
            sessionLog.info(`tool_start: ${event.toolName} (${event.toolUseId})`)
          } else if (event.type === 'tool_result') {
            sessionLog.info(`tool_result: ${event.toolUseId} isError=${event.isError}`)
          } else {
            sessionLog.info('Got event:', event.type)
          }
        }

        // Process the event first
        await this.processEvent(managed, event)

        // Fallback: Capture SDK session ID if the onSdkSessionIdUpdate callback didn't fire.
        // Primary capture happens in getOrCreateAgent() via onSdkSessionIdUpdate callback,
        // which immediately flushes to disk. This fallback handles edge cases where the
        // callback might not fire (e.g., SDK version mismatch, callback not supported).
        if (!managed.sdkSessionId) {
          const sdkId = agent.getSessionId()
          if (sdkId) {
            managed.sdkSessionId = sdkId
            sessionLog.info(`Captured SDK session ID via fallback: ${sdkId}`)
            // Also flush here since we're in fallback mode
            this.persistSession(managed)
            sessionPersistenceQueue.flush(managed.id)
          }
        }

        // Handle complete event - SDK always sends this (even after interrupt)
        // This is the central place where processing ends
        if (event.type === 'complete') {
          // Auth/plan handoff paths already stopped processing and emitted a complete
          // event to the renderer. Ignore the backend's trailing complete to avoid
          // double cleanup and duplicate UI completion events.
          if (!managed.isProcessing) {
            sessionLog.info('Chat completed after explicit handoff/stop; skipping normal completion handling')
            sendSpan.mark('chat.complete.already_stopped')
            sendSpan.end()
            return
          }

          sessionLog.info('Chat completed via complete event')

          // Check if we got an assistant response in this turn
          // If not, the SDK may have hit context limits or other issues
          const lastAssistantMsg = [...managed.messages].reverse().find(m =>
            m.role === 'assistant' && !m.isIntermediate
          )
          const lastUserMsg = [...managed.messages].reverse().find(m => m.role === 'user')

          // If the last user message is newer than any assistant response, we got no reply
          // This can happen due to context overflow or API issues
          if (lastUserMsg && (!lastAssistantMsg || lastUserMsg.timestamp > lastAssistantMsg.timestamp)) {
            sessionLog.warn(`Session ${sessionId} completed without assistant response - possible context overflow or API issue`)

            // Check if there's a captured API error that explains the silent failure.
            // Pass explicit session path to avoid reading from the wrong session
            // (_sessionDir singleton can be clobbered by concurrent sessions).
            const sessionErrorPath = getSessionStoragePath(managed.workspace.rootPath, managed.id)
            const apiError = getLastApiError(sessionErrorPath)

            if (apiError && apiError.status === 400) {
              const isImageError = apiError.message?.includes('image exceeds')

              const errorMessage: Message = {
                id: generateMessageId(),
                role: 'error',
                content: isImageError
                  ? `Image Too Large: ${apiError.message}`
                  : `Request Error: ${apiError.message}`,
                timestamp: this.monotonic(),
                errorCode: isImageError ? 'image_too_large' : 'invalid_request',
                errorTitle: isImageError ? 'Image Too Large' : 'Invalid Request',
                errorDetails: isImageError
                  ? ['An image in the conversation exceeds the 5 MB API limit.',
                     'This session cannot recover — the image is embedded in the history.',
                     'Please start a new session to continue.']
                  : [apiError.message],
                errorCanRetry: false,
              }
              managed.messages.push(errorMessage)
              this.sendEvent({
                type: 'typed_error',
                sessionId,
                error: {
                  code: isImageError ? 'image_too_large' as const : 'invalid_request' as const,
                  title: errorMessage.errorTitle!,
                  message: apiError.message,
                  actions: [],
                  canRetry: false,
                  details: errorMessage.errorDetails,
                },
              }, managed.workspace.id)
            }
          }

          if (event.usage) sendSpan.setMetadata('usage', event.usage)
          sendSpan.mark('chat.complete')
          await this.onProcessingStopped(sessionId, 'complete')
          sendSpan.mark('session.flushed')
          sendSpan.end()
          return  // Exit function, skip finally block (onProcessingStopped handles cleanup)
        }

        // NOTE: We no longer break early on !isProcessing or stopRequested.
        // After soft interrupt (forceAbort), the backend sets turnComplete=true which causes
        // the generator to yield remaining queued events and then complete naturally.
        // This ensures we don't lose in-flight messages.
      }

      // Loop exited - either via complete event (normal) or generator ended after soft interrupt
      if (turnWatchdog.getTimeout()) {
        sessionLog.info('Chat loop exited after turn watchdog timeout')
        sendSpan.mark('chat.timeout')
        sendSpan.end()
      } else if (!managed.isProcessing) {
        sessionLog.info('Chat loop exited after explicit handoff/stop')
        sendSpan.mark('chat.exit.already_stopped')
        sendSpan.end()
      } else if (managed.stopRequested) {
        sessionLog.info('Chat loop completed after stop request - events drained successfully')
        await this.onProcessingStopped(sessionId, 'interrupted')
      } else {
        sessionLog.info('Chat loop exited unexpectedly')
      }
    })
    } catch (error) {
      // Check if this is an abort error (expected when interrupted)
      const isAbortError = error instanceof Error && (
        error.name === 'AbortError' ||
        error.message === 'Request was aborted.' ||
        error.message.includes('aborted')
      )

      if (isAbortError) {
        // Extract abort reason if available (safety net for unexpected abort propagation)
        const reason = (error as DOMException).cause as AbortReason | undefined

        sessionLog.info(`Chat aborted (reason: ${reason || 'unknown'})`)
        sendSpan.mark('chat.aborted')
        sendSpan.setMetadata('abort_reason', reason || 'unknown')
        sendSpan.end()

        // UI handoff paths (plan submission, auth request) handle their own cleanup
        // by setting isProcessing = false directly. All other abort reasons route
        // through onProcessingStopped for queue draining.
        if (reason === AbortReason.UserStop || reason === AbortReason.Redirect || reason === undefined) {
          await this.onProcessingStopped(sessionId, 'interrupted')
        }
      } else {
        sessionLog.error('Error in chat:', error)
        sessionLog.error('Error message:', error instanceof Error ? error.message : String(error))
        sessionLog.error('Error stack:', error instanceof Error ? error.stack : 'No stack')

        // Report chat/SDK errors via runtime hooks (Electron can forward to Sentry)
        sessionRuntimeHooks.captureException(error, { errorSource: 'chat', sessionId })

        sendSpan.mark('chat.error')
        sendSpan.setMetadata('error', error instanceof Error ? error.message : String(error))
        sendSpan.end()
        this.sendEvent({
          type: 'error',
          sessionId,
          error: error instanceof Error ? error.message : 'Unknown error'
        }, managed.workspace.id)
        // Handle error via centralized handler
        if (managed.isProcessing) await this.onProcessingStopped(sessionId, 'error')
      }
    } finally {
      turnWatchdog.stop()
      // Only handle cleanup for unexpected exits (loop break without complete event)
      // Normal completion returns early after calling onProcessingStopped
      // Errors are handled in catch block
      if (managed.isProcessing && managed.processingGeneration === myGeneration) {
        sessionLog.info('Finally block cleanup - unexpected exit')
        sendSpan.mark('chat.unexpected_exit')
        sendSpan.end()
        await this.onProcessingStopped(sessionId, 'interrupted')
      }
    }

    // Title inference shares the same runtime lease, so start it only after
    // the interactive turn releases ownership of the Pi runtime.
    if (titleMessageToGenerate && !managed.runtimeState) {
      void this.generateTitle(managed, titleMessageToGenerate)
    }
    } finally {
      releaseSessionOperation()
    }
  }

  async cancelProcessing(sessionId: string, silent = false): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed?.isProcessing) {
      return // Not processing, nothing to cancel
    }

    sessionLog.info('Cancelling processing for session:', sessionId, silent ? '(silent)' : '')

    // Collect queued message text for input restoration before clearing
    const queuedTexts = managed.messageQueue.map(q => q.message)

    // Collect queued message IDs so we can remove them from the messages array
    // (they were added when sendMessage was called during processing)
    const queuedMessageIds = new Set(
      managed.messageQueue.map(q => q.messageId).filter((id): id is string => !!id)
    )

    // Clear queue - user explicitly stopped, don't process queued messages
    managed.messageQueue = []

    // Remove queued user messages from the persisted messages array
    if (queuedMessageIds.size > 0) {
      managed.messages = managed.messages.filter(m => !queuedMessageIds.has(m.id))
    }

    // Signal intent to stop - let the event loop drain remaining events before clearing isProcessing
    // This prevents losing in-flight messages after soft interrupt
    managed.stopRequested = true

    // Track interruption so the next user message gets a context note
    // telling the LLM the previous response was cut short
    managed.wasInterrupted = true

    // Force-abort via Query.close() - sends soft interrupt to the backend
    if (managed.agent) {
      managed.agent.forceAbort(AbortReason.UserStop)
    }
    this.cancelPendingUserQuestionsForSession(sessionId)

    // Only show "Response interrupted" message when user explicitly clicked Stop
    // Silent mode is used when redirecting (sending new message while processing)
    if (!silent) {
      const interruptedMessage: Message = {
        id: generateMessageId(),
        role: 'info',
        content: 'Response interrupted',
        timestamp: this.monotonic(),
      }
      managed.messages.push(interruptedMessage)
      this.sendEvent({
        type: 'interrupted',
        sessionId,
        message: interruptedMessage,
        // Include queued texts so the UI can restore them to the input field
        ...(queuedTexts.length > 0 ? { queuedMessages: queuedTexts } : {}),
      }, managed.workspace.id)
    } else {
      // Still send interrupted event but without the message (for UI state update)
      this.sendEvent({
        type: 'interrupted',
        sessionId,
        // Include queued texts so the UI can restore them to the input field
        ...(queuedTexts.length > 0 ? { queuedMessages: queuedTexts } : {}),
      }, managed.workspace.id)
    }

    // Safety timeout: if event loop doesn't complete within 5 seconds, force cleanup
    // This handles cases where the generator gets stuck
    setTimeout(() => {
      if (managed.stopRequested && managed.isProcessing) {
        sessionLog.warn('Generator did not complete after stop request, forcing cleanup')
        void this.onProcessingStopped(sessionId, 'timeout').catch(error => {
          sessionLog.error('Failed to stop processing after cancel timeout:', error)
        })
      }
    }, 5000)

    // NOTE: We don't clear isProcessing or send complete event here anymore.
    // The event loop will drain remaining events and call onProcessingStopped when done.
  }

  async sendQueuedMessageNow(sessionId: string, messageId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      throw new Error(`Session ${sessionId} not found`)
    }

    await this.ensureMessagesLoaded(managed)

    const queuedIndex = managed.messageQueue.findIndex(entry => entry.messageId === messageId)
    if (queuedIndex < 0) {
      throw new Error(`Queued message ${messageId} not found`)
    }

    const [selected] = managed.messageQueue.splice(queuedIndex, 1)
    if (!selected) {
      throw new Error(`Queued message ${messageId} not found`)
    }
    managed.messageQueue.unshift(selected)
    this.persistSession(managed)

    if (!managed.isProcessing) {
      this.processNextQueuedMessage(sessionId)
      return
    }

    sessionLog.info('Sending queued message now:', {
      sessionId,
      messageId,
      queueLength: managed.messageQueue.length,
    })

    managed.stopRequested = true
    managed.wasInterrupted = true

    if (managed.agent) {
      managed.agent.forceAbort(AbortReason.Redirect)
    }

    this.sendEvent({
      type: 'interrupted',
      sessionId,
      reason: 'queued_handoff',
    }, managed.workspace.id)

    setTimeout(() => {
      if (managed.stopRequested && managed.isProcessing) {
        sessionLog.warn('Generator did not complete after queued send-now request, forcing cleanup')
        void this.onProcessingStopped(sessionId, 'timeout').catch(error => {
          sessionLog.error('Failed to stop queued processing after timeout:', error)
        })
      }
    }, 5000)
  }

  async removeQueuedMessage(sessionId: string, messageId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      throw new Error(`Session ${sessionId} not found`)
    }

    await this.ensureMessagesLoaded(managed)

    const queuedIndex = managed.messageQueue.findIndex(entry => entry.messageId === messageId)
    if (queuedIndex < 0) {
      throw new Error(`Queued message ${messageId} not found`)
    }

    managed.messageQueue.splice(queuedIndex, 1)
    managed.messages = managed.messages.filter(message => message.id !== messageId)
    this.persistSession(managed)

    this.sendEvent({
      type: 'queued_message_removed',
      sessionId,
      messageId,
    }, managed.workspace.id)
  }

  /**
   * Central handler for when processing stops (any reason).
   * Single source of truth for cleanup and queue processing.
   *
   * @param sessionId - The session that stopped processing
   * @param reason - Why processing stopped ('complete' | 'interrupted' | 'error')
   */
  private async onProcessingStopped(
    sessionId: string,
    reason: 'complete' | 'interrupted' | 'error' | 'timeout'
  ): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed) return

    sessionLog.info(`Processing stopped for session ${sessionId}: ${reason}`)

    // 1. Cleanup state
    this.setProcessing(managed, false)
    managed.stopRequested = false  // Reset for next turn

    const turnStartFinalMessageId = managed.turnStartFinalMessageId
    managed.turnStartFinalMessageId = undefined
    managed.turnStartedAt = undefined

    // Clear agent control overlay between turns. The session keeps browser
    // ownership (boundSessionId) — only the visual overlay is removed.
    // Full unbind happens below when the queue is empty (session truly done).
    if (this.browserPaneManager) {
      await this.browserPaneManager.clearVisualsForSession(sessionId)
    }

    // 2. Handle unread state based on whether user is viewing this session
    //    This is the explicit state machine for NEW badge:
    //    - If user is viewing: mark as read (they saw it complete)
    //    - If user is NOT viewing: mark as unread (they have new content)
    //    IMPORTANT: only apply this when the turn produced a NEW final output.
    const isViewing = this.isSessionBeingViewed(sessionId, managed.workspace.id)
    const currentFinalMessageId = this.getLastFinalOutputMessageId(managed.messages)
    const didReceiveNewFinalOutput = !!currentFinalMessageId && currentFinalMessageId !== turnStartFinalMessageId

    if (reason === 'complete' && didReceiveNewFinalOutput) {
      if (isViewing) {
        // User is watching - mark as read immediately
        await this.markSessionRead(sessionId)
      } else {
        // User is not watching - mark as unread for NEW badge
        if (!managed.hasUnread) {
          managed.hasUnread = true
          this.emitUnreadSummaryChanged()
        }
      }
    }

    // 3. Auto-complete mini agent sessions to avoid session list clutter
    //    Mini agents are spawned from EditPopovers for quick config edits
    //    and should automatically move to 'done' when finished
    if (reason === 'complete' && managed.systemPromptPreset === 'mini' && managed.sessionStatus !== 'done') {
      sessionLog.info(`Auto-completing mini agent session ${sessionId}`)
      await this.setSessionStatus(sessionId, 'done')
    }

    // 4. Apply deferred external metadata updates captured while processing.
    if (managed.pendingExternalMetadata) {
      const pendingHeader = managed.pendingExternalMetadata
      managed.pendingExternalMetadata = undefined
      sessionLog.info(`Applying deferred external metadata for session ${sessionId} after processing stop`)
      this.applyExternalSessionMetadata(managed, pendingHeader)
    }

    // 5. Commit the complete in-memory snapshot before announcing completion.
    this.persistSession(managed)
    await this.flushSession(sessionId)

    // 6. Check queue and process or complete
    if (managed.messageQueue.length > 0) {
      // Has queued messages - process next
      this.processNextQueuedMessage(sessionId)
    } else {
      // Session is truly done — release browser ownership.
      // The window stays alive (hidden) and becomes reusable by future sessions.
      // On the next turn, getOrCreateForSession() will re-bind it.
      if (this.browserPaneManager) {
        await this.browserPaneManager.clearVisualsForSession(sessionId)
        this.browserPaneManager.unbindAllForSession(sessionId)
      }

      // No queue - emit complete to UI (include tokenUsage and hasUnread for state updates)
      this.sendEvent({
        type: 'complete',
        sessionId,
        tokenUsage: managed.tokenUsage,
        turnMetrics: managed.pendingTurnMetrics
          ? Array.from(managed.pendingTurnMetrics, ([messageId, metrics]) => ({ messageId, metrics }))
          : undefined,
        hasUnread: managed.hasUnread,  // Propagate unread state to renderer
      }, managed.workspace.id)
      managed.pendingTurnMetrics = undefined
    }
  }

  /**
   * Process the next message in the queue.
   * Called by onProcessingStopped when queue has messages.
   */
  private processNextQueuedMessage(sessionId: string): void {
    const managed = this.sessions.get(sessionId)
    if (!managed || managed.messageQueue.length === 0) return

    const next = managed.messageQueue.shift()!
    sessionLog.info('replay queued', {
      sessionId,
      messageId: next.messageId,
      queueLengthAfterShift: managed.messageQueue.length,
    })

    // Update UI: queued → processing
    if (next.messageId) {
      const existingIndex = managed.messages.findIndex(m => m.id === next.messageId)
      const existingMessage = managed.messages[existingIndex]
      if (existingMessage) {
        // Replay starts a new turn after the response that just completed.
        existingMessage.isQueued = false
        delete existingMessage.queuedWorkspaceFreshnessContext
        existingMessage.timestamp = this.monotonic()
        managed.messages.splice(existingIndex, 1)
        managed.messages.push(existingMessage)
        this.persistSession(managed)

        this.sendEvent({
          type: 'user_message',
          sessionId,
          message: existingMessage,
          status: 'processing',
          optimisticMessageId: next.optimisticMessageId
        }, managed.workspace.id)
      }
    }

    // Process message (use setImmediate to allow current stack to clear)
    setImmediate(() => {
      this.sendMessage(
        sessionId,
        next.message,
        next.attachments,
        next.storedAttachments,
        next.options,
        next.messageId
      ).catch(err => {
        sessionLog.error('replay failed', {
          sessionId,
          messageId: next.messageId,
          error: err instanceof Error ? err.message : String(err),
        })
        // Report queued message failures via runtime hooks
        sessionRuntimeHooks.captureException(err, { errorSource: 'chat-queue', sessionId })
        // Surface a typed error so the UI can show a clear, actionable banner
        // instead of a generic "Unknown error" (#616).
        this.sendEvent({
          type: 'typed_error',
          sessionId,
          error: {
            code: 'queued_message_replay_failed',
            title: 'Queued message could not be sent',
            message: 'A message you sent while the agent was running could not be re-sent automatically. Tap retry to send it now.',
            actions: [{ key: 'r', label: 'Retry', action: 'retry' }],
            canRetry: true,
            originalError: err instanceof Error ? err.message : String(err),
          },
        }, managed.workspace.id)
        // Call onProcessingStopped to handle cleanup and check for more queued messages
        void this.onProcessingStopped(sessionId, 'error').catch(error => {
          sessionLog.error('Failed to stop processing after queued message failure:', error)
        })
      })
    })
  }

  async killShell(sessionId: string, shellId: string): Promise<{ success: boolean; error?: string }> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      return { success: false, error: 'Session not found' }
    }

    sessionLog.info(`Killing shell ${shellId} for session: ${sessionId}`)

    // Try to kill the actual process using the stored command
    const command = managed.backgroundShellCommands.get(shellId)
    if (command) {
      try {
        // Use pkill to find and kill processes matching the command
        // The -f flag matches against the full command line
        const { exec } = await import('child_process')
        const { promisify } = await import('util')
        const execAsync = promisify(exec)

        // Escape the command for use in pkill pattern
        // We search for the unique command string in process args
        const escapedCommand = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

        sessionLog.info(`Attempting to kill process with command: ${command.slice(0, 100)}...`)

        // Use pgrep first to find the PID, then kill it
        // This is safer than pkill -f which can match too broadly
        try {
          const { stdout } = await execAsync(`pgrep -f "${escapedCommand}"`)
          const pids = stdout.trim().split('\n').filter(Boolean)

          if (pids.length > 0) {
            sessionLog.info(`Found ${pids.length} process(es) to kill: ${pids.join(', ')}`)
            // Kill each process
            for (const pid of pids) {
              try {
                await execAsync(`kill -TERM ${pid}`)
                sessionLog.info(`Sent SIGTERM to process ${pid}`)
              } catch (killErr) {
                // Process may have already exited
                sessionLog.warn(`Failed to kill process ${pid}: ${killErr}`)
              }
            }
          } else {
            sessionLog.info(`No processes found matching command`)
          }
        } catch (pgrepErr) {
          // pgrep returns exit code 1 when no processes found, which is fine
          sessionLog.info(`No matching processes found (pgrep returned no results)`)
        }

        // Clean up the stored command
        managed.backgroundShellCommands.delete(shellId)
      } catch (err) {
        sessionLog.error(`Error killing shell process: ${err}`)
      }
    } else {
      sessionLog.warn(`No command stored for shell ${shellId}, cannot kill process`)
    }

    // Always emit shell_killed to remove from UI regardless of process kill success
    this.sendEvent({
      type: 'shell_killed',
      sessionId,
      shellId,
    }, managed.workspace.id)

    return { success: true }
  }

  /**
   * Get output from a background task
   *
   * Looks up the output file stored when a task_completed event was received,
   * reads its contents, and returns them. Falls back to the SDK-provided summary
   * if the file cannot be read.
   *
   * @param taskId - The task or shell ID
   * @returns Task output content, or null if task not found
   */
  async getTaskOutput(taskId: string): Promise<string | null> {
    // O(1) lookup via taskOutputIndex
    const sessionId = this.taskOutputIndex.get(taskId)
    if (!sessionId) {
      sessionLog.info(`No output found for task: ${taskId} (task may still be running)`)
      return null
    }

    const managed = this.sessions.get(sessionId)
    const info = managed?.backgroundTaskOutputs.get(taskId)
    if (!info) {
      // Index out of sync — clean up stale entry
      this.taskOutputIndex.delete(taskId)
      return null
    }

    sessionLog.info(`Found output for task ${taskId}: file=${info.outputFile}, status=${info.status}`)
    try {
      const content = await readFile(info.outputFile, 'utf-8')
      // Delete after successful read to prevent memory leak
      managed!.backgroundTaskOutputs.delete(taskId)
      this.taskOutputIndex.delete(taskId)
      return content
    } catch (err) {
      sessionLog.error(`Failed to read task output file: ${info.outputFile}`, err)
      // Fall back to SDK-provided summary
      return info.summary || null
    }
  }

  /**
   * Respond to a pending permission request
   * Returns true if the response was delivered, false if agent/session is gone
   */
  respondToPermission(
    sessionId: string,
    requestId: string,
    allowed: boolean,
    alwaysAllow: boolean,
    options?: import('@craft-agent/shared/protocol').PermissionResponseOptions,
  ): boolean {
    const managed = this.sessions.get(sessionId)
    if (managed?.agent) {
      const requestMeta = this.pendingPermissionRequests.get(requestId)
      this.pendingPermissionRequests.delete(requestId)

      if (requestMeta?.type === 'admin_approval') {
        const brokerResult = this.privilegedExecutionBroker.resolveApproval(requestId, allowed, {
          expectedCommandHash: requestMeta.commandHash,
        })
        if (!brokerResult.ok) {
          sessionLog.warn(`Admin approval rejected by broker for ${requestId}: ${brokerResult.reason}`)
          // Broker rejection should fail closed.
          managed.agent.respondToPermission(requestId, false, false)
          return false
        }

        if (allowed && requestMeta.commandHash && options?.rememberForMinutes) {
          this.storeAdminRememberApproval(sessionId, requestMeta.commandHash, requestId, options.rememberForMinutes)
        }
      }

      sessionLog.info(`Permission response for ${requestId}: allowed=${allowed}, alwaysAllow=${alwaysAllow}`)
      managed.agent.respondToPermission(requestId, allowed, alwaysAllow)
      return true
    } else {
      sessionLog.warn(`Cannot respond to permission - no agent for session ${sessionId}`)
      return false
    }
  }

  respondToUserQuestion(
    sessionId: string,
    requestId: string,
    response: UserQuestionResponse,
  ): boolean {
    const pending = this.pendingUserQuestions.get(requestId)
    if (!pending || pending.sessionId !== sessionId) return false

    this.pendingUserQuestions.delete(requestId)
    pending.resolve(response)
    return true
  }

  /**
   * Respond to a pending credential request
   * Returns true if the response was delivered, false if no pending request found
   *
   * Supports both:
   * - New unified auth flow (via handleCredentialInput)
   * - Legacy callback flow (via pendingCredentialResolvers)
   */
  async respondToCredential(sessionId: string, requestId: string, response: import('@craft-agent/shared/protocol').CredentialResponse): Promise<boolean> {
    // First, check if this is a new unified auth flow request
    const managed = this.sessions.get(sessionId)
    if (managed?.pendingAuthRequest && managed.pendingAuthRequest.requestId === requestId) {
      sessionLog.info(`Credential response (unified flow) for ${requestId}: cancelled=${response.cancelled}`)
      await this.handleCredentialInput(sessionId, requestId, response)
      return true
    }

    // Fall back to legacy callback flow
    const resolver = this.pendingCredentialResolvers.get(requestId)
    if (resolver) {
      sessionLog.info(`Credential response (legacy flow) for ${requestId}: cancelled=${response.cancelled}`)
      resolver(response)
      this.pendingCredentialResolvers.delete(requestId)
      return true
    } else {
      sessionLog.warn(`Cannot respond to credential - no pending request for ${requestId}`)
      return false
    }
  }

  /**
   * Set the permission mode for a session ('safe', 'ask', 'allow-all')
   */
  setSessionPermissionMode(sessionId: string, mode: PermissionMode): void {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      const previousManagedMode = managed.permissionMode ?? 'ask'
      const diagnosticsBefore = getPermissionModeDiagnostics(sessionId)
      const previousEffectiveMode = diagnosticsBefore.permissionMode

      // No-op only when BOTH managed state and mode-manager state already match.
      // If managed state matches but diagnostics drifted, heal authoritative mode state.
      if (previousManagedMode === mode && previousEffectiveMode === mode) {
        return
      }

      if (previousManagedMode === mode && previousEffectiveMode !== mode) {
        sessionLog.warn('Permission mode drift detected on same-mode update; reconciling authoritative mode state', {
          sessionId,
          managedMode: previousManagedMode,
          diagnosticsMode: previousEffectiveMode,
          targetMode: mode,
          modeVersion: diagnosticsBefore.modeVersion,
          changedBy: diagnosticsBefore.lastChangedBy,
        })
      }

      // Update in-memory managed mode first
      managed.permissionMode = mode

      // Reconcile mode-manager state for this specific session.
      if (previousEffectiveMode !== mode) {
        const changedBy = previousManagedMode === mode ? 'restore' : 'user'
        setPermissionMode(sessionId, mode, { changedBy })
      }

      const diagnostics = getPermissionModeDiagnostics(sessionId)
      managed.previousPermissionMode = diagnostics.previousPermissionMode
      sessionLog.info('Permission mode changed', {
        sessionId,
        permissionMode: mode,
        modeVersion: diagnostics.modeVersion,
        changedBy: diagnostics.lastChangedBy,
        changedAt: diagnostics.lastChangedAt,
      })

      // Forward to the agent instance so backends can propagate mode changes downstream.
      if (managed.agent) {
        managed.agent.setPermissionMode(mode)
      }

      this.sendEvent({
        type: 'permission_mode_changed',
        sessionId: managed.id,
        permissionMode: mode,
        modeVersion: diagnostics.modeVersion,
        changedBy: diagnostics.lastChangedBy,
        changedAt: diagnostics.lastChangedAt,
        previousPermissionMode: diagnostics.previousPermissionMode,
        transitionDisplay: diagnostics.transitionDisplay,
      }, managed.workspace.id)
      // Persist to disk
      this.persistSession(managed)
    }
  }

  /**
   * Get authoritative permission mode diagnostics for a session.
   * Used by renderer to reconcile optimistic/stale mode state.
   */
  getSessionPermissionModeState(sessionId: string): {
    permissionMode: PermissionMode
    previousPermissionMode?: PermissionMode
    transitionDisplay?: string
    modeVersion: number
    changedAt: string
    changedBy: 'user' | 'system' | 'restore' | 'automation' | 'unknown'
  } | null {
    const managed = this.sessions.get(sessionId)
    if (!managed) return null

    let diagnostics = getPermissionModeDiagnostics(sessionId)

    // Hydrate persisted transition context when mode-manager has been reset (e.g. app restart).
    if (managed.previousPermissionMode && !diagnostics.previousPermissionMode) {
      hydratePreviousPermissionMode(sessionId, managed.previousPermissionMode)
      diagnostics = getPermissionModeDiagnostics(sessionId)
    }

    // Heal restore races where mode-manager still has default state while
    // session metadata already has a persisted non-default mode.
    if (managed.permissionMode && diagnostics.permissionMode !== managed.permissionMode) {
      sessionLog.warn('Permission mode diagnostics mismatch, reconciling to managed session mode', {
        sessionId,
        managedMode: managed.permissionMode,
        diagnosticsMode: diagnostics.permissionMode,
        modeVersion: diagnostics.modeVersion,
        changedBy: diagnostics.lastChangedBy,
      })
      setPermissionMode(sessionId, managed.permissionMode, { changedBy: 'restore' })
      if (managed.previousPermissionMode) {
        hydratePreviousPermissionMode(sessionId, managed.previousPermissionMode)
      }
      diagnostics = getPermissionModeDiagnostics(sessionId)
    }

    managed.previousPermissionMode = diagnostics.previousPermissionMode

    return {
      permissionMode: diagnostics.permissionMode,
      previousPermissionMode: diagnostics.previousPermissionMode,
      transitionDisplay: diagnostics.transitionDisplay,
      modeVersion: diagnostics.modeVersion,
      changedAt: diagnostics.lastChangedAt,
      changedBy: diagnostics.lastChangedBy,
    }
  }

  /**
   * Set labels for a session (additive tags, many-per-session).
   * Labels are IDs referencing workspace labels/config.json.
   */
  async setSessionLabels(sessionId: string, labels: string[]): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.labels = labels
      this.setMetadataWriteGuard(managed)

      this.sendEvent({
        type: 'labels_changed',
        sessionId: managed.id,
        labels: managed.labels,
      }, managed.workspace.id)
      // Persist in-memory state directly to avoid race with pending queue writes
      this.persistSession(managed)
      await this.flushSession(managed.id)
      // Workaround: Bun's fs.watch({ recursive: true }) on Linux doesn't track
      // directories created after the watcher started.
      // https://github.com/oven-sh/bun/issues/15939
      const watcher = this.configWatchers.get(managed.workspace.rootPath)
      watcher?.notifyFileChange(`sessions/${sessionId}/session.jsonl`)
    }
  }

  /**
   * Set the thinking level for a session. See {@link ThinkingLevel} for valid values.
   * This is sticky and persisted across messages.
   */
  setSessionThinkingLevel(sessionId: string, level: ThinkingLevel): void {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      // Update thinking level in managed session
      managed.thinkingLevel = level

      // Update the agent's thinking level if it exists
      if (managed.agent) {
        managed.agent.setThinkingLevel(level)
      }

      sessionLog.info(`Session ${sessionId}: thinking level set to ${level}`)
      // Persist to disk
      this.persistSession(managed)
    }
  }

  /**
   * Generate an AI title for a session from the user's first message.
   * Uses the agent's generateTitle() method which handles provider-specific SDK calls.
   * If no agent exists, creates a temporary one using the session's connection.
   */
  private async generateTitle(managed: ManagedSession, userMessage: string): Promise<void> {
    sessionLog.info(`[generateTitle] Starting for session ${managed.id}`)

    try {
      const title = await this.withAgentRuntimeLease(
        managed,
        async (agent) => {
          const title = await agent.generateTitle(userMessage, { language: getCurrentLanguageName() })
          if (!title) return title

          managed.name = title
          this.persistSession(managed)
          // Keep persistence inside the lease so deletion cannot pass its
          // writer boundary and then be followed by a stale title write.
          await this.flushSession(managed.id)
          this.sendEvent({ type: 'title_generated', sessionId: managed.id, title }, managed.workspace.id)
          return title
        },
      )
      if (title) {
        sessionLog.info(`Generated title for session ${managed.id}: "${title}"`)
      } else {
        sessionLog.warn(`Title generation returned null for session ${managed.id}`)
      }
    } catch (error) {
      sessionLog.error(`Failed to generate title for session ${managed.id}:`, error)

      // Surface quota/auth errors to the user — these indicate the main chat call will also fail
      const errorMsg = error instanceof Error ? error.message : String(error)
      if (
        this.sessions.get(managed.id) === managed
        && managed.runtimeState !== 'deleting'
        && (errorMsg.includes('quota') || errorMsg.includes('429') || errorMsg.includes('401') || errorMsg.includes('insufficient'))
      ) {
        this.sendEvent({
          type: 'typed_error',
          sessionId: managed.id,
          error: {
            code: 'provider_error',
            title: 'API Error',
            message: `API error: ${errorMsg.slice(0, 200)}`,
            actions: [{ key: 'r', label: 'Retry', action: 'retry' }],
            canRetry: true,
          }
        }, managed.workspace.id)
      }
    }
  }

  private async processEvent(managed: ManagedSession, event: AgentEvent): Promise<void> {
    const sessionId = managed.id
    const workspaceId = managed.workspace.id

    switch (event.type) {
      case 'text_delta':
        managed.streamingText += event.text
        // Queue delta for batched sending (performance: reduces IPC from 50+/sec to ~20/sec)
        this.queueDelta(sessionId, workspaceId, event.text, event.turnId)
        break

      case 'text_complete': {
        // Flush any pending deltas before sending complete (ensures renderer has all content)
        this.flushDelta(sessionId, workspaceId)
        const canBranch = resolveLiveAssistantBranchability(managed, event)

        const assistantMessage: Message = {
          id: generateMessageId(),
          role: 'assistant',
          content: event.text,
          timestamp: this.monotonic(),
          isIntermediate: event.isIntermediate,
          turnId: event.turnId,
          parentToolUseId: event.parentToolUseId,
          canBranch,
        }
        managed.messages.push(assistantMessage)
        managed.streamingText = ''

        // Update lastMessageRole and lastFinalMessageId for badge/unread display (only for final messages)
        if (!event.isIntermediate) {
          managed.lastMessageRole = 'assistant'
          managed.lastFinalMessageId = assistantMessage.id

          const sessionPath = getSessionStoragePath(managed.workspace.rootPath, sessionId)

          // Pi branch-cutoff support: persist provider-native turn anchor in session sidecar.
          // Keeps session.jsonl schema unchanged while enabling strict branch cutoffs later.
          if (event.sdkTurnAnchor) {
            try {
              await savePiTurnAnchor(sessionPath, assistantMessage.id, event.sdkTurnAnchor)
            } catch (error) {
              sessionLog.warn(`Failed to persist Pi turn anchor for session ${sessionId}:`, error)
            }
          }
        }

        this.sendEvent({ type: 'text_complete', sessionId, text: event.text, isIntermediate: event.isIntermediate, turnId: event.turnId, parentToolUseId: event.parentToolUseId, timestamp: assistantMessage.timestamp, messageId: assistantMessage.id, canBranch }, workspaceId)

        // Persist session after complete message to prevent data loss on quit
        this.persistSession(managed)
        break
      }

      case 'tool_start': {
        const toolInput = await captureWriteOriginalContent({
          toolName: event.toolName,
          input: event.input,
          workspaceRootPath: managed.workspace.rootPath,
          validatePath: (path) => validateFilePath(path, getWorkspaceAllowedDirs(workspaceId)),
          readTextFile: (path) => readFile(path, 'utf-8'),
        })
        // Format tool input paths to relative for better readability
        const formattedToolInput = formatToolInputPaths(toolInput)
        if (formattedToolInput && typeof toolInput.previous_content === 'string') {
          formattedToolInput.previous_content = toolInput.previous_content
        }

        // Resolve call_llm model for TurnCard badge display.
        // Resolve call_llm model short names to full IDs for display.
        // Note: Pi sessions override the model in PiEventAdapter (call_llm always uses miniModel).
        if (event.toolName === 'mcp__session__call_llm' && formattedToolInput?.model) {
          const shortName = String(formattedToolInput.model)
          const modelDef = MODEL_REGISTRY.find(m => m.id === shortName)
            || MODEL_REGISTRY.find(m => m.shortName.toLowerCase() === shortName.toLowerCase())
            || MODEL_REGISTRY.find(m => m.name.toLowerCase() === shortName.toLowerCase())
          if (modelDef) {
            formattedToolInput.model = modelDef.id
          }
        }

        // Resolve tool display metadata (icon, displayName) for skills/sources
        // Only resolve when we have input (second event for SDK dual-event pattern)
        const projectRoot = getResourceProjectRoot(managed.workspace)
        let toolDisplayMeta: ToolDisplayMeta | undefined
        if (formattedToolInput && Object.keys(formattedToolInput).length > 0) {
          const allSources = loadAllSources(projectRoot)
          toolDisplayMeta = await resolveToolDisplayMeta(
            event.toolName,
            formattedToolInput,
            managed.workingDirectory ?? projectRoot,
            allSources,
          )
        }

        // Check if a message with this toolUseId already exists FIRST
        // SDK sends two events per tool: first from stream_event (empty input),
        // second from assistant message (complete input)
        const existingStartMsg = managed.messages.find(m => m.toolUseId === event.toolUseId)
        const isDuplicateEvent = !!existingStartMsg

        // Use parentToolUseId directly from the projected Pi event
        // from SDK's parent_tool_use_id (authoritative, handles parallel Tasks correctly).
        // No stack or map needed; the event carries the correct parent from the start.
        const parentToolUseId = event.parentToolUseId

        // Track if we need to send an event to the renderer
        // Send on: first occurrence OR when we have new input data to update
        let shouldSendEvent = !isDuplicateEvent

        if (existingStartMsg) {
          // Update existing message with complete input (second event has full input)
          if (formattedToolInput && Object.keys(formattedToolInput).length > 0) {
            const hadInputBefore = existingStartMsg.toolInput && Object.keys(existingStartMsg.toolInput).length > 0
            existingStartMsg.toolInput = formattedToolInput
            // Send update event if we're adding input that wasn't there before
            if (!hadInputBefore) {
              shouldSendEvent = true
            }
          }
          // Also set parent if not already set
          if (parentToolUseId && !existingStartMsg.parentToolUseId) {
            existingStartMsg.parentToolUseId = parentToolUseId
          }
          // Set toolDisplayMeta if not already set (has base64 icon for viewer)
          if (toolDisplayMeta && !existingStartMsg.toolDisplayMeta) {
            existingStartMsg.toolDisplayMeta = toolDisplayMeta
          }
          // Update toolIntent if not already set (second event has intent from complete input)
          if (event.intent && !existingStartMsg.toolIntent) {
            existingStartMsg.toolIntent = event.intent
          }
          // Update toolDisplayName if not already set
          if (event.displayName && !existingStartMsg.toolDisplayName) {
            existingStartMsg.toolDisplayName = event.displayName
          }
        } else {
          // Add tool message immediately (will be updated on tool_result)
          // This ensures tool calls are persisted even if they don't complete
          const toolStartMessage: Message = {
            id: generateMessageId(),
            role: 'tool',
            content: `Running ${event.toolName}...`,
            timestamp: this.monotonic(),
            toolName: event.toolName,
            toolUseId: event.toolUseId,
            toolInput: formattedToolInput,
            toolStatus: 'executing',
            toolIntent: event.intent,
            toolDisplayName: event.displayName,
            toolDisplayMeta,  // Includes base64 icon for viewer compatibility
            turnId: event.turnId,
            parentToolUseId,
          }
          managed.messages.push(toolStartMessage)
        }

        // Activate browser agent control overlay on actionable browser tool starts.
        // Skip browser_tool help/release commands to avoid pointless overlay flashes.
        const shouldActivateOverlay = shouldActivateBrowserOverlay(
          event.toolName,
          formattedToolInput,
        )

        if (this.browserPaneManager && shouldActivateOverlay) {
          // Ensure first browser action in a turn gets an instance before overlay activation.
          this.browserPaneManager.getOrCreateForSession(sessionId)

          const resolvedDisplayName = toolDisplayMeta?.displayName
            ?? event.displayName
            ?? event.toolName
          this.browserPaneManager.setAgentControl(sessionId, {
            displayName: resolvedDisplayName,
            intent: event.intent,
          })
        }

        // Send event to renderer on first occurrence OR when input data is updated
        if (shouldSendEvent) {
          const timestamp = existingStartMsg?.timestamp ?? this.monotonic()
          this.sendEvent({
            type: 'tool_start',
            sessionId,
            toolName: event.toolName,
            toolUseId: event.toolUseId,
            toolInput: formattedToolInput ?? {},
            toolIntent: event.intent,
            toolDisplayName: event.displayName,
            toolDisplayMeta,  // Includes base64 icon for viewer compatibility
            turnId: event.turnId,
            parentToolUseId,
            timestamp,
          }, workspaceId)
        }
        break
      }

      case 'tool_result': {
        // toolName comes directly from the normalized Agent event.
        const toolName = event.toolName || 'unknown'

        // Format absolute paths to relative paths for better readability
        const rawFormattedResult = event.result ? formatPathsToRelative(event.result) : ''

        // Safety net: prevent massive tool results from bloating session JSONL (protects all backends)
        const MAX_PERSISTED_RESULT_CHARS = 200_000 // ~50K tokens
        const formattedResult = rawFormattedResult.length > MAX_PERSISTED_RESULT_CHARS
          ? rawFormattedResult.slice(0, MAX_PERSISTED_RESULT_CHARS) +
            `\n\n[Truncated for storage: ${rawFormattedResult.length.toLocaleString()} chars total]`
          : rawFormattedResult

        // Some backends omit explicit isError but still prefix with [ERROR].
        const inferredError = event.isError === true || /^\s*(\[ERROR\]|Error:|error:)/.test(formattedResult)

        // Update existing tool message (created on tool_start) instead of creating new one
        const existingToolMsg = managed.messages.find(m => m.toolUseId === event.toolUseId)
        // Track if already completed to avoid sending duplicate events
        const wasAlreadyComplete = existingToolMsg?.toolStatus === 'completed'

        sessionLog.info(`RESULT MATCH: toolUseId=${event.toolUseId}, found=${!!existingToolMsg}, toolName=${existingToolMsg?.toolName || toolName}, wasComplete=${wasAlreadyComplete}`)

        // parentToolUseId comes from Pi (runtime-authoritative) or the existing message
        const parentToolUseId = existingToolMsg?.parentToolUseId || event.parentToolUseId

        if (existingToolMsg) {
          // Keep lightweight status text in `content` and store full payload in `toolResult` only.
          existingToolMsg.toolResult = formattedResult
          existingToolMsg.toolStatus = inferredError ? 'error' : 'completed'
          existingToolMsg.isError = inferredError
          // If message doesn't have parent set, use event's parentToolUseId
          if (!existingToolMsg.parentToolUseId && event.parentToolUseId) {
            existingToolMsg.parentToolUseId = event.parentToolUseId
          }
        } else {
          // No matching tool_start found — create message from result.
          // This is normal for background subagent child tools where tool_result arrives
          // without a prior tool_start. If tool_start arrives later, findToolMessage will
          // locate this message by toolUseId and update it with input/intent/displayMeta.
          sessionLog.info(`RESULT WITHOUT START: toolUseId=${event.toolUseId}, toolName=${toolName} (creating message from result)`)
          const fallbackProjectRoot = getResourceProjectRoot(managed.workspace)
          const fallbackSources = loadAllSources(fallbackProjectRoot)
          const fallbackToolDisplayMeta = await resolveToolDisplayMeta(
            toolName,
            undefined,
            managed.workingDirectory ?? fallbackProjectRoot,
            fallbackSources,
          )

          const toolMessage: Message = {
            id: generateMessageId(),
            role: 'tool',
            content: '',
            timestamp: this.monotonic(),
            toolName: toolName,
            toolUseId: event.toolUseId,
            toolResult: formattedResult,
            toolStatus: inferredError ? 'error' : 'completed',
            toolDisplayMeta: fallbackToolDisplayMeta,
            parentToolUseId,
            isError: inferredError,
          }
          managed.messages.push(toolMessage)
        }

        // Send event to renderer if: (a) first completion, or (b) result content changed
        // (e.g., safety net auto-completed with empty result, then real result arrived later)
        const resultChanged = wasAlreadyComplete && formattedResult && existingToolMsg?.toolResult !== formattedResult
        if (!wasAlreadyComplete || resultChanged) {
          // Use existing tool message timestamp, or fallback message timestamp for ordering
          const toolResultTimestamp = existingToolMsg?.timestamp ?? (managed.messages.find(m => m.toolUseId === event.toolUseId)?.timestamp)
          this.sendEvent({
            type: 'tool_result',
            sessionId,
            toolUseId: event.toolUseId,
            toolName: toolName,
            result: formattedResult,
            turnId: event.turnId,
            parentToolUseId,
            isError: inferredError,
            timestamp: toolResultTimestamp,
          }, workspaceId)
        }

        // Safety net: when a parent Task completes, mark all its still-pending child tools as completed.
        // This handles the case where child tool_result events never arrive (e.g., subagent internal tools
        // whose results aren't surfaced through the parent stream).
        if (isParentTaskTool(toolName) || toolName === 'TaskOutput') {
          const pendingChildren = managed.messages.filter(
            m => m.parentToolUseId === event.toolUseId
              && m.toolStatus !== 'completed'
              && m.toolStatus !== 'error'
          )
          for (const child of pendingChildren) {
            child.toolStatus = 'completed'
            child.toolResult = child.toolResult || ''
            sessionLog.info(`CHILD AUTO-COMPLETED: toolUseId=${child.toolUseId}, toolName=${child.toolName} (parent ${toolName} completed)`)
            this.sendEvent({
              type: 'tool_result',
              sessionId,
              toolUseId: child.toolUseId!,
              toolName: child.toolName || 'unknown',
              result: child.toolResult || '',
              turnId: child.turnId,
              parentToolUseId: event.toolUseId,
            }, workspaceId)
          }
        }

        // Persist session after tool completes to prevent data loss on quit
        this.persistSession(managed)
        break
      }

      case 'status':
        this.sendEvent({
          type: 'status',
          sessionId,
          message: event.message,
          statusType: event.statusType ?? (event.message.includes('Compacting') ? 'compacting' : undefined)
        }, workspaceId)
        break

      case 'info': {
        const isCompactionComplete = event.statusType === 'compaction_complete' || event.message.startsWith('Compacted')
        const infoTimestamp = this.monotonic()

        // Persist compaction messages so they survive reload
        // Other info messages are transient (just sent to renderer)
        if (isCompactionComplete) {
          const compactionMessage: Message = {
            id: generateMessageId(),
            role: 'info',
            content: event.message,
            timestamp: infoTimestamp,
            statusType: 'compaction_complete',
          }
          managed.messages.push(compactionMessage)

          // Mark compaction complete in the session state.
          // This is done here (backend) rather than in the renderer so it's
          // not affected by CMD+R during compaction. The frontend reload
          // recovery will see awaitingCompaction=false and trigger execution.
          await markStoredCompactionComplete(managed.workspace.rootPath, sessionId)
          sessionLog.info(`Session ${sessionId}: compaction complete, marked pending plan ready`)
        }

        this.sendEvent({
          type: 'info',
          sessionId,
          message: event.message,
          level: event.level,
          statusType: isCompactionComplete ? 'compaction_complete' : undefined,
          timestamp: infoTimestamp,
        }, workspaceId)
        break
      }

      case 'error': {
        // Skip errors after handoff (plan submission, auth request) — the SDK may emit
        // an error from the interrupted query after we've already stopped processing.
        if (!managed.isProcessing) {
          sessionLog.info('Skipping error event after handoff/stop:', event.message)
          break
        }

        // Skip abort errors - these are expected when force-aborting via Query.close()
        if (event.message.includes('aborted') || event.message.includes('AbortError')) {
          sessionLog.info('Skipping abort error event (expected during interrupt)')
          break
        }

        // Defensive: detect auth-expiry text in plain errors that weren't classified
        // as typed_error (e.g. Pi SDK error path or future provider changes).
        const lowerErr = event.message.toLowerCase()
        const isPlainAuthError =
          lowerErr.includes('token is expired') ||
          lowerErr.includes('authentication token is expired') ||
          lowerErr.includes('please try signing in again') ||
          lowerErr.includes('invalid model access token') ||
          (lowerErr.includes('401') && (lowerErr.includes('unauthorized') || lowerErr.includes('auth')))

        if (isPlainAuthError) {
          const connectionSlug = resolveManagedConnectionSlug(managed)
          if (isManagedDefaultGatewayConnection(connectionSlug)) {
            void this.refreshManagedCredentialForNextTurn(managed)
          }
        }

        // AgentEvent uses `message` not `error`
        const errorMessage: Message = {
          id: generateMessageId(),
          role: 'error',
          content: event.message,
          timestamp: this.monotonic()
        }
        managed.messages.push(errorMessage)
        this.sendEvent({ type: 'error', sessionId, error: event.message, timestamp: errorMessage.timestamp }, workspaceId)
        break
      }

      case 'typed_error':
        // Skip errors after handoff (plan submission, auth request)
        if (!managed.isProcessing) {
          sessionLog.info('Skipping typed_error event after handoff/stop:', event.error.message || event.error.title)
          break
        }

        // Skip abort errors - these are expected when force-aborting via Query.close()
        const typedErrorMsg = event.error.message || event.error.title || ''
        if (typedErrorMsg.includes('aborted') || typedErrorMsg.includes('AbortError')) {
          sessionLog.info('Skipping typed abort error event (expected during interrupt)')
          break
        }
        const connectionSlug = resolveManagedConnectionSlug(managed)
        const typedError = normalizeManagedDefaultGatewayAuthError(event.error, connectionSlug)

        // Typed errors have structured information - send both formats for compatibility
        sessionLog.info('typed_error:', JSON.stringify(typedError, null, 2))

        const isAuthError = typedError.code === 'invalid_api_key' ||
          typedError.code === 'expired_oauth_token'

        if (isAuthError && isManagedDefaultGatewayConnection(connectionSlug)) {
          void this.refreshManagedCredentialForNextTurn(managed)
        }

        // Build rich error message with all diagnostic fields for persistence and UI display
        const typedErrorMessage: Message = {
          id: generateMessageId(),
          role: 'error',
          // Combine title and message for content display (handles undefined gracefully)
          content: [typedError.title, typedError.message].filter(Boolean).join(': ') || 'An error occurred',
          timestamp: this.monotonic(),
          // Rich error fields for diagnostics and retry functionality
          errorCode: typedError.code,
          errorTitle: typedError.title,
          errorDetails: typedError.details,
          errorOriginal: typedError.originalError,
          errorCanRetry: typedError.canRetry,
        }
        managed.messages.push(typedErrorMessage)
        // Send typed_error event with full structure for renderer to handle
        this.sendEvent({
          type: 'typed_error',
          sessionId,
          error: {
            code: typedError.code,
            title: typedError.title,
            message: typedError.message,
            actions: typedError.actions,
            canRetry: typedError.canRetry,
            details: typedError.details,
            originalError: typedError.originalError,
          },
          timestamp: typedErrorMessage.timestamp,
        }, workspaceId)
        break

      case 'task_backgrounded':
      case 'task_progress':
        // Forward background task events directly to renderer
        this.sendEvent({
          ...event,
          sessionId,
        }, workspaceId)
        break

      case 'task_completed':
        // Store output for later retrieval via getTaskOutput()
        if (managed) {
          managed.backgroundTaskOutputs.set(event.taskId, {
            outputFile: event.outputFile || '',
            summary: event.summary || '',
            status: event.status,
            completedAt: Date.now(),
          })
          // O(1) index for getTaskOutput() — avoids scanning all sessions
          this.taskOutputIndex.set(event.taskId, sessionId)
          sessionLog.info(`Background task ${event.taskId} completed (status=${event.status})`)

          // Evict stale entries older than 1 hour to bound memory growth
          const ONE_HOUR = 3_600_000
          const now = Date.now()
          for (const [tid, info] of managed.backgroundTaskOutputs) {
            if (now - info.completedAt > ONE_HOUR) {
              managed.backgroundTaskOutputs.delete(tid)
              this.taskOutputIndex.delete(tid)
            }
          }
        }
        // Forward to renderer for UI update
        this.sendEvent({
          ...event,
          sessionId,
        }, workspaceId)
        break

      case 'shell_backgrounded':
        // Store the command for later process killing
        if (event.command && managed) {
          managed.backgroundShellCommands.set(event.shellId, event.command)
          sessionLog.info(`Stored command for shell ${event.shellId}: ${event.command.slice(0, 50)}...`)
        }
        // Forward to renderer
        this.sendEvent({
          ...event,
          sessionId,
        }, workspaceId)
        break

      case 'complete':
        // Projected Pi completion - accumulate usage from this turn
        // Actual 'complete' sent to renderer comes from the finally block in sendMessage
        this.accumulateTurnUsage(managed, event.usage)

        {
          const finalMessageId = this.getLastFinalOutputMessageId(managed.messages)
          if (finalMessageId && finalMessageId !== managed.turnStartFinalMessageId) {
            const finalMessage = managed.messages.findLast(message => message.id === finalMessageId)
            if (finalMessage) {
              this.attachTurnMetrics(managed, finalMessage, event.usage)
            }
          }
        }
        break

      case 'usage_update':
        // Real-time usage update for context display during processing
        // Update managed session's tokenUsage with latest context size
        if (event.usage) {
          if (!managed.tokenUsage) {
            managed.tokenUsage = {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              contextTokens: 0,
              costUsd: 0,
            }
          }
          // Live updates are current context size, not cumulative session input.
          managed.tokenUsage.contextTokens = event.usage.contextTokens
          if (event.usage.contextWindow) {
            managed.tokenUsage.contextWindow = event.usage.contextWindow
          }

          // Send to renderer for immediate UI update
          this.sendEvent({
            type: 'usage_update',
            sessionId: managed.id,
            tokenUsage: {
              contextTokens: event.usage.contextTokens,
              contextWindow: event.usage.contextWindow,
            },
          }, workspaceId)
        }
        break

      case 'steer_undelivered':
        // Steer message was not delivered (no PreToolUse fired before turn ended).
        // Re-queue it so it's sent as a normal message on the next turn.
        sessionLog.info(`Steer message undelivered, re-queuing for session ${sessionId}`)
        managed.messageQueue.push({ message: event.message })
        managed.wasInterrupted = true
        break

      // Note: working_directory_changed is user-initiated only (via updateWorkingDirectory),
      // the agent no longer has a change_working_directory tool
    }
  }

  private sendEvent(event: SessionEvent, workspaceId?: string): void {
    if (!this.eventSink) {
      sessionLog.warn('Cannot send event - no event sink')
      return
    }

    if (!workspaceId) {
      sessionLog.warn(`Cannot send ${event.type} event - no workspaceId`)
      return
    }

    this.eventSink(RPC_CHANNELS.sessions.EVENT, { to: 'workspace', workspaceId }, event)
  }

  /**
   * Queue a text delta for batched sending (performance optimization)
   * Instead of sending 50+ IPC events per second, batches deltas and flushes every 50ms
   */
  private queueDelta(sessionId: string, workspaceId: string, delta: string, turnId?: string): void {
    const existing = this.pendingDeltas.get(sessionId)
    if (existing) {
      // Append to existing batch
      existing.delta += delta
      // Keep the latest turnId (should be the same, but just in case)
      if (turnId) existing.turnId = turnId
    } else {
      // Start new batch
      this.pendingDeltas.set(sessionId, { delta, turnId })
    }

    // Schedule flush if not already scheduled
    if (!this.deltaFlushTimers.has(sessionId)) {
      const timer = setTimeout(() => {
        this.flushDelta(sessionId, workspaceId)
      }, DELTA_BATCH_INTERVAL_MS)
      this.deltaFlushTimers.set(sessionId, timer)
    }
  }

  /**
   * Flush any pending deltas for a session (sends batched IPC event)
   * Called on timer or when streaming ends (text_complete)
   */
  private flushDelta(sessionId: string, workspaceId: string): void {
    // Clear the timer
    const timer = this.deltaFlushTimers.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      this.deltaFlushTimers.delete(sessionId)
    }

    // Send batched delta if any
    const pending = this.pendingDeltas.get(sessionId)
    if (pending && pending.delta) {
      this.sendEvent({
        type: 'text_delta',
        sessionId,
        delta: pending.delta,
        turnId: pending.turnId
      }, workspaceId)
      this.pendingDeltas.delete(sessionId)
    }
  }

  /**
   * Execute a prompt automation by creating a new session and sending the prompt.
   *
   * The options-object form replaced the previous positional-args signature
   * once the param list outgrew readability — `thinkingLevel` was the trigger.
   * When `thinkingLevel` is omitted, `createSession` falls back to the
   * workspace default (then DEFAULT_THINKING_LEVEL).
   */
  async executePromptAutomation(
    input: ExecutePromptAutomationInput,
  ): Promise<{ sessionId: string }> {
    const {
      workspaceId,
      workspaceRootPath,
      prompt,
      labels,
      permissionMode,
      mentions,
      llmConnection,
      model,
      thinkingLevel,
      automationName,
      telegramTopic,
    } = input

    // Warn if llmConnection was specified but doesn't resolve
    if (llmConnection) {
      const connection = resolveSessionConnection(llmConnection)
      if (!connection) {
        sessionLog.warn(`[Automations] llmConnection "${llmConnection}" not found, using default`)
      }
    }

    // Resolve @mentions to source/skill slugs
    const resolved = mentions
      ? await this.resolveAutomationMentions(workspaceRootPath, mentions)
      : undefined

    // Ensure labels exist in workspace config before assigning to session
    const resolvedLabels = labels?.length
      ? ensureLabelsExist(workspaceRootPath, labels)
      : labels

    // Use automation name if provided, otherwise fall back to prompt snippet
    const fallback = `Automation: ${prompt.slice(0, 50)}${prompt.length > 50 ? '...' : ''}`
    const sessionName = automationName || fallback

    // Create a new session for this automation
    const session = await this.createSession(workspaceId, {
      name: sessionName,
      labels: resolvedLabels,
      permissionMode: permissionMode || 'safe',
      enabledSourceSlugs: resolved?.sourceSlugs,
      llmConnection,
      model,
      thinkingLevel,
    })

    // Populate triggeredBy metadata so title generation is explicitly skipped
    // and the session is identifiable as automation-initiated after reload
    const managed = this.sessions.get(session.id)
    if (managed) {
      managed.triggeredBy = { automationName, timestamp: Date.now() }
      this.persistSession(managed)
    }

    // Notify renderer to hydrate full session metadata (including title)
    // before streaming events arrive. Without this, the renderer may create
    // a synthetic empty session and temporarily show "New chat".
    this.sendEvent({ type: 'session_created', sessionId: session.id }, workspaceId)

    // Bind the new session to its Telegram forum topic if the matcher
    // declared `telegramTopic`. Done before `sendMessage` so the first
    // assistant tokens already route through the bound topic. Failure
    // is logged inside the binder; the session continues unbound.
    if (this.automationBinder && telegramTopic && telegramTopic.trim().length > 0) {
      try {
        await this.automationBinder({
          workspaceId,
          sessionId: session.id,
          topicName: telegramTopic.trim(),
        })
      } catch (err) {
        sessionLog.warn('[Automations] automation binder threw', {
          sessionId: session.id,
          telegramTopic,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Send the prompt
    const effectivePrompt = canonicalizeSkillReferences(prompt, resolved?.skillSlugs ?? [])
    await this.sendMessage(session.id, effectivePrompt, undefined, undefined, {
      skillSlugs: resolved?.skillSlugs,
    })

    return { sessionId: session.id }
  }

  /**
   * Resolve @mentions in automation prompts to source and skill slugs
   */
  private async resolveAutomationMentions(
    workspaceRootPath: string,
    mentions: string[],
  ): Promise<{ sourceSlugs: string[]; skillSlugs: string[] } | undefined> {
    const sources = loadWorkspaceSources(workspaceRootPath)
    const { skills } = await loadPiSkillCatalog(workspaceRootPath)
    const sourceSlugs: string[] = []
    const skillSlugs: string[] = []

    for (const mention of mentions) {
      if (sources.some(s => s.config.slug === mention)) {
        sourceSlugs.push(mention)
      } else if (skills.some(s => s.slug === mention)) {
        skillSlugs.push(mention)
      } else {
        sessionLog.warn(`[Automations] Unknown mention: @${mention}`)
      }
    }

    return (sourceSlugs.length > 0 || skillSlugs.length > 0) ? { sourceSlugs, skillSlugs } : undefined
  }

  // ============================================
  // Export / Import / Dispatch
  // ============================================

  private async generateRemoteTransferSummary(managed: ManagedSession): Promise<string | null> {
    await this.ensureMessagesLoaded(managed)

    const messages = managed.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .filter(m => !m.isIntermediate)
      .map(m => ({
        type: m.role as 'user' | 'assistant',
        content: m.content,
      }))

    if (messages.length === 0) return null
    const managedModelAccess = await this.resolveManagedModelAccess(managed)

    const workspaceRootPath = managed.workspace.rootPath
    const wsConfig = loadWorkspaceConfig(workspaceRootPath)
    const defaultModel = wsConfig?.defaults?.model
    const backendContext = resolveBackendContext({
      sessionConnectionSlug: managed.llmConnection,
      workspaceDefaultConnectionSlug: wsConfig?.defaults?.defaultLlmConnection,
      managedModel: managed.model || defaultModel,
    })

    const miniModel = backendContext.connection
      ? (getMiniModel(backendContext.connection) ?? backendContext.connection.defaultModel ?? getDefaultSummarizationModel())
      : getDefaultSummarizationModel()

    const envOverrides: Record<string, string> = {
      CRAFT_WORKSPACE_PATH: workspaceRootPath,
      ...(miniModel ? { ANTHROPIC_DEFAULT_HAIKU_MODEL: miniModel } : {}),
    }

    const agent = new PiAgent(resolvePiAgentConfig({
      context: backendContext,
      hostRuntime: buildBackendHostRuntimeContext(),
      coreConfig: {
        workspace: managed.workspace,
        session: {
          id: `${managed.id}-remote-transfer-summary`,
          workspaceRootPath,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          workingDirectory: managed.workingDirectory,
          sdkCwd: managed.sdkCwd,
          model: managed.model,
          llmConnection: managed.llmConnection,
          permissionMode: managed.permissionMode,
          previousPermissionMode: managed.previousPermissionMode,
        },
        miniModel,
        managedModelAccess,
        envOverrides,
        isHeadless: true,
      },
      providerOptions: { piAuthProvider: backendContext.connection?.piAuthProvider },
    }))

    try {
      return await generateConversationSummary(messages, agent.runMiniCompletion.bind(agent))
    } finally {
      agent.destroy()
    }
  }

  async exportRemoteSessionTransfer(sessionId: string, workspaceId: string): Promise<RemoteSessionTransferPayload | null> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      sessionLog.warn(`[dispatch] Cannot export remote transfer: ${sessionId} not found`)
      return null
    }

    if (managed.workspace.id !== workspaceId) {
      sessionLog.warn(`[dispatch] Session ${sessionId} does not belong to workspace ${workspaceId}`)
      return null
    }

    if (managed.isProcessing) {
      sessionLog.warn(`[dispatch] Cannot export remote transfer ${sessionId}: still processing`)
      return null
    }

    this.persistSession(managed)
    await sessionPersistenceQueue.flush(sessionId)

    const summary = await this.generateRemoteTransferSummary(managed)
    if (!summary) {
      sessionLog.warn(`[dispatch] Failed to generate remote transfer summary for ${sessionId}`)
      return null
    }

    return { summary }
  }

  async importRemoteSessionTransfer(
    workspaceId: string,
    payload: RemoteSessionTransferPayload,
  ): Promise<{ sessionId: string }> {
    if (!payload || typeof payload !== 'object' || typeof payload.summary !== 'string' || !payload.summary.trim()) {
      throw new Error('Invalid remote session transfer payload')
    }

    // The target session starts with target-domain defaults. Operational state
    // such as permission mode, labels, and status must never cross domains.
    const session = await this.createSession(workspaceId)

    const managed = this.sessions.get(session.id)
    if (!managed) {
      throw new Error(`Transferred session ${session.id} was not created`)
    }

    managed.transferredSessionSummary = payload.summary.trim()
    managed.transferredSessionSummaryApplied = false
    this.persistSession(managed)
    await sessionPersistenceQueue.flush(session.id)

    return { sessionId: session.id }
  }

  /**
   * Export a session as a portable SessionBundle.
   *
   * Steps:
   * 1. Validate session exists and resolve its workspace
   * 2. If session is processing, refuse (caller must stop it first)
   * 3. Flush pending persistence writes
   * 4. Serialize session directory into a bundle
   */
  async exportSession(sessionId: string, workspaceId: string): Promise<SessionBundle | null> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      sessionLog.warn(`[dispatch] Cannot export session: ${sessionId} not found`)
      return null
    }

    if (managed.workspace.id !== workspaceId) {
      sessionLog.warn(`[dispatch] Session ${sessionId} does not belong to workspace ${workspaceId}`)
      return null
    }

    if (managed.isProcessing) {
      sessionLog.warn(`[dispatch] Cannot export session ${sessionId}: still processing`)
      return null
    }

    // Flush pending writes to ensure JSONL is up to date
    this.persistSession(managed)
    await sessionPersistenceQueue.flush(sessionId)

    const bundle = serializeSession(managed.workspace.rootPath, sessionId)
    if (!bundle) {
      sessionLog.error(`[dispatch] Failed to serialize session ${sessionId}`)
      return null
    }

    return bundle
  }

  /**
   * Import a session bundle into a target workspace.
   *
   * Steps:
   * 1. Validate bundle structure and target workspace
   * 2. Generate new session ID (fork) or use original (move)
   * 3. Create session directory and write JSONL + files
   * 4. Register session in-memory
   * 5. Emit session_created event
   * 6. Return new session ID and compatibility warnings
   */
  async importSession(
    workspaceId: string,
    bundle: SessionBundle,
    mode: DispatchMode,
  ): Promise<{ sessionId: string; warnings?: string[] }> {
    sessionLog.info(`[import] Starting import: workspaceId=${workspaceId}, mode=${mode}, bundleSessionId=${bundle?.session?.header?.id ?? 'unknown'}, files=${bundle?.files?.length ?? 0}`)

    if (!validateBundle(bundle)) {
      throw new Error('Invalid session bundle')
    }

    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`)
    }

    sessionLog.info(`[import] Target workspace: "${workspace.name}" at ${workspace.rootPath}`)

    const warnings: string[] = []
    const workspaceRootPath = workspace.rootPath

    // Determine session ID
    const sessionId = mode === 'move'
      ? bundle.session.header.id
      : generateSessionId(workspaceRootPath)

    // Check for ID collision on move
    if (mode === 'move' && this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists in target workspace`)
    }

    // Create session directory with all subdirectories
    const sessionDir = ensureSessionDir(workspaceRootPath, sessionId)

    // Build the stored session from bundle data
    const header = bundle.session.header
    let importedLegacyAgentRuntime = header.agentRuntime
    const storedSession: StoredSession = {
      id: sessionId,
      workspaceRootPath,
      sdkSessionId: header.sdkSessionId, // Preserved initially; fork logic below may clear it
      // Always regenerate sdkCwd for the target workspace.
      // The source sdkCwd points to a path on the originating server
      // which doesn't exist here (cross-server transfer).
      sdkCwd: getSessionStoragePath(workspaceRootPath, sessionId),
      name: header.name,
      createdAt: header.createdAt,
      lastUsedAt: Date.now(),
      lastMessageAt: header.lastMessageAt,
      isFlagged: header.isFlagged,
      permissionMode: header.permissionMode,
      previousPermissionMode: header.previousPermissionMode,
      sessionStatus: header.sessionStatus,
      labels: header.labels,
      enabledSourceSlugs: header.enabledSourceSlugs,
      workingDirectory: header.workingDirectory,
      model: header.model,
      llmConnection: header.llmConnection,
      connectionLocked: header.connectionLocked,
      thinkingLevel: header.thinkingLevel,
      hidden: header.hidden,
      transferredSessionSummary: header.transferredSessionSummary,
      transferredSessionSummaryApplied: header.transferredSessionSummaryApplied,
      messages: bundle.session.messages,
      tokenUsage: header.tokenUsage ?? DEFAULT_TOKEN_USAGE,
    }

    // Portable bundles intentionally omit hidden provider transcripts. A fork
    // must therefore seed one fresh runtime from product messages; preserving
    // native IDs would point at state that was never transferred.
    if (mode === 'fork') {
      importedLegacyAgentRuntime = undefined
      storedSession.sharedUrl = undefined
      storedSession.sharedId = undefined
      resetPortableForkRuntime(storedSession)

      // Credentials are target-local. Rebind to a compatible connection when
      // available, but never treat that as proof the source transcript exists.
      const sourceProviderType = header.llmConnection
        ? getLlmConnection(header.llmConnection)?.providerType
        : undefined
      const compatibleConnection = sourceProviderType
        ? this.findCompatibleLlmConnection(workspaceRootPath, sourceProviderType)
        : null

      if (compatibleConnection) {
        sessionLog.info(`[import] Fork: compatible ${sourceProviderType} connection "${compatibleConnection}" found — seeding a fresh runtime`)
        storedSession.llmConnection = compatibleConnection
        storedSession.connectionLocked = false
      } else {
        if (storedSession.llmConnection) {
          sessionLog.info(`[import] Fork: no compatible ${sourceProviderType ?? 'unknown'} connection — clearing for target default`)
        }
        storedSession.llmConnection = undefined
        storedSession.connectionLocked = false
      }
      // Clear thinking level so the session inherits the workspace default
      storedSession.thinkingLevel = undefined
      // Clear working directory — the source path won't exist on a different server.
      // The user can set a new cwd after the session is transferred.
      storedSession.workingDirectory = undefined
    }

    // Check source compatibility (before writing JSONL so fixes are persisted)
    if (storedSession.enabledSourceSlugs?.length) {
      const availableSources = loadWorkspaceSources(workspaceRootPath)
      const availableSlugs = new Set(availableSources.map(s => s.config.slug))
      const missingSources = storedSession.enabledSourceSlugs.filter(s => !availableSlugs.has(s))
      if (missingSources.length > 0) {
        sessionLog.warn(`[import] Sources not available: ${missingSources.join(', ')}`)
        warnings.push(`Sources not available in target workspace: ${missingSources.join(', ')}`)
      }
    }

    // Check LLM connection compatibility for move mode (fork already cleared above)
    if (mode === 'move' && storedSession.llmConnection) {
      sessionLog.info(`[import] Checking LLM connection: "${storedSession.llmConnection}"`)
      const conn = resolveSessionConnection(storedSession.llmConnection, undefined)
      if (!conn) {
        sessionLog.warn(`[import] LLM connection "${storedSession.llmConnection}" not found — clearing to use default`)
        warnings.push(`LLM connection "${storedSession.llmConnection}" not found in target — session will use default`)
        storedSession.llmConnection = undefined
        storedSession.connectionLocked = false
      } else {
        sessionLog.info(`[import] LLM connection "${storedSession.llmConnection}" resolved OK`)
      }
    } else if (mode === 'move' && !storedSession.llmConnection) {
      sessionLog.info('[import] No LLM connection in bundle — will use default')
    }

    // Write JSONL file (after compatibility checks so remapped values are persisted)
    const sessionFile = getSessionFilePath(workspaceRootPath, sessionId)
    sessionLog.info(`[import] Writing JSONL: ${sessionFile} (llmConnection=${storedSession.llmConnection ?? 'default'}, messages=${storedSession.messages.length})`)
    writeSessionJsonl(sessionFile, storedSession)

    // Write all bundle files (attachments, plans, data, downloads, etc.)
    // Uses restoreFiles() for path traversal, size, and base64 validation.
    restoreFiles(sessionDir, bundle.files)

    // Register in-memory — pass session metadata without messages to avoid
    // StoredMessage[] vs Message[] type mismatch, then convert messages separately
    const { messages: bundleMessages, ...sessionMeta } = storedSession
    const managed = createManagedSession({ ...sessionMeta, legacyAgentRuntime: importedLegacyAgentRuntime }, workspace, {
      messagesLoaded: true,
      workingDirectory: storedSession.workingDirectory,
    })
    managed.messages = bundleMessages.map(storedToMessage)

    setPermissionMode(sessionId, managed.permissionMode ?? 'ask', { changedBy: 'restore' })
    if (managed.previousPermissionMode) {
      hydratePreviousPermissionMode(sessionId, managed.previousPermissionMode)
    }

    this.sessions.set(sessionId, managed)

    // Initialize automation metadata
    const automationSystem = this.automationSystems.get(workspaceRootPath)
    if (automationSystem) {
      automationSystem.setInitialSessionMetadata(sessionId, {
        permissionMode: storedSession.permissionMode,
        labels: storedSession.labels,
        isFlagged: storedSession.isFlagged,
        sessionStatus: storedSession.sessionStatus,
        sessionName: managed.name,
      })
    }

    // Emit session_created so renderer picks it up
    this.sendEvent({ type: 'session_created', sessionId }, workspaceId)

    sessionLog.info(`[import] Complete: sessionId=${sessionId}, transferredSummary=${managed.transferredSessionSummary ? `${managed.transferredSessionSummary.length} chars` : 'none'}, applied=${managed.transferredSessionSummaryApplied}, warnings=${warnings.length > 0 ? warnings.join('; ') : 'none'}`)
    return { sessionId, warnings: warnings.length > 0 ? warnings : undefined }
  }

  /**
   * Find an LLM connection on this server that matches the given provider type.
   * Checks workspace default first, then falls back to any matching connection.
   */
  private findCompatibleLlmConnection(workspaceRootPath: string, providerType: string): string | null {
    const wsConfig = loadWorkspaceConfig(workspaceRootPath)
    const defaultSlug = wsConfig?.defaults?.defaultLlmConnection
    if (defaultSlug) {
      const conn = getLlmConnection(defaultSlug)
      if (conn?.providerType === providerType) return defaultSlug
    }
    // Fall back: any connection with matching provider type
    const connections = getLlmConnections()
    const match = connections.find(c => c.providerType === providerType)
    return match?.slug ?? null
  }

  /**
   * Clean up all resources held by the SessionManager.
   * Should be called on app shutdown to prevent resource leaks.
   */
  cleanup(): void {
    sessionLog.info('Cleaning up resources...')
    const configWatcherCount = this.configWatchers.size
    const automationSystemCount = this.automationSystems.size

    // Stop all ConfigWatchers (file system watchers)
    for (const [path, watcher] of this.configWatchers) {
      watcher.stop()
      sessionLog.debug(`Stopped config watcher for ${path}`)
    }
    this.configWatchers.clear()

    // Dispose all AutomationSystems (includes scheduler, handlers, and event loggers)
    for (const [workspacePath, automationSystem] of this.automationSystems) {
      try {
        automationSystem.dispose()
        sessionLog.debug(`Disposed AutomationSystem for ${workspacePath}`)
      } catch (error) {
        sessionLog.error(`Failed to dispose AutomationSystem for ${workspacePath}:`, error)
      }
    }
    this.automationSystems.clear()

    // Clear all pending delta flush timers
    for (const timer of this.deltaFlushTimers.values()) {
      clearTimeout(timer)
    }
    this.deltaFlushTimers.clear()
    this.pendingDeltas.clear()

    // Clear pending credential resolvers (they won't be resolved, but prevents memory leak)
    this.pendingCredentialResolvers.clear()
    this.pendingPermissionRequests.clear()
    for (const pending of this.pendingUserQuestions.values()) {
      pending.resolve({ answers: {}, cancelled: true })
    }
    this.pendingUserQuestions.clear()
    this.adminRememberApprovals.clear()

    // Clean up session-scoped tool callbacks for all sessions
    for (const sessionId of this.sessions.keys()) {
      unregisterSessionScopedToolCallbacks(sessionId)
    }

    sessionLog.info('Cleanup complete', { configWatcherCount, automationSystemCount })
  }
}
