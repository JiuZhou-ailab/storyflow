// input: Workspace sessions, Pi product projections, persistence stores, and Host services
// output: Durable product session state, projected Pi events, and explicit user commands
// pos: Storyflow Product Host session boundary; Pi owns Agent turn execution

import type { EventSink } from '@craft-agent/server-core/transport'
import type { ISessionManager, IBrowserPaneManager, ExecutePromptAutomationInput } from '@craft-agent/server-core/handlers'
import { validateFilePath, getWorkspaceAllowedDirs } from '@craft-agent/server-core/handlers'
import { basename, join } from 'path'
import { readFile, mkdir } from 'fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { type AgentEvent, setPermissionMode, hydratePreviousPermissionMode, type PermissionMode, unregisterSessionScopedToolCallbacks, AbortReason, type AuthRequest, type AuthResult } from '@craft-agent/shared/agent'
import type { UserQuestionResponse } from '@craft-agent/session-tools-core'
import {
  resolveSessionConnection,
  resolveBackendContext,
  cleanupSourceRuntimeArtifacts,
} from '@craft-agent/shared/agent/backend'
import type {
  ConversationRewindRequest,
  ConversationRewindResult,
  ManagedModelAccess,
} from '@craft-agent/shared/agent/backend/types'
import { getDefaultThinkingLevel } from '@craft-agent/shared/config'
import { PrivilegedExecutionBroker } from '@craft-agent/server-core/services'
import {
  getWorkspaces,
  getWorkspaceByNameOrId,
  loadConfigDefaults,
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
  loadSession as loadStoredSession,
  saveSession as saveStoredSession,
  createSession as createStoredSession,
  deleteSession as deleteStoredSession,
  updateSessionMetadata,
  markCompactionComplete as markStoredCompactionComplete,
  clearPendingPlanExecution as clearStoredPendingPlanExecution,
  getSessionPath as getSessionStoragePath,
  sessionPersistenceQueue,
  getHeaderMetadataSignature,
  type SessionBundle,
  type DispatchMode,
  type StoredSession,
  type StoredMessage,

  type SessionStatus,
  type SessionHeader,
} from '@craft-agent/shared/sessions'
import { loadWorkspaceSources, loadAllSources, getSourcesBySlugs, isSourceUsable, type LoadedSource, TokenRefreshManager } from '@craft-agent/shared/sources'
import { ConfigWatcher, type ConfigWatcherCallbacks } from '@craft-agent/shared/config'
import { getLastApiError } from '@craft-agent/shared/provider-diagnostics'
import { isParentTaskTool } from '@craft-agent/shared/utils/toolNames'
import { isLowSignal } from '@craft-agent/shared/utils'
import { type Session, type SessionEvent, type FileAttachment, type SendMessageOptions, type OneShotLlmRequest, type OneShotLlmResult, type NovelSelectionRewriteRequest, type NovelSelectionRewriteResult, type UnreadSummary, type RemoteSessionTransferPayload, generateMessageId } from '@craft-agent/shared/protocol'
import { type Message, type StoredAttachment, type ToolDisplayMeta, type TurnMetrics, type TurnUsage } from '@craft-agent/core/types'
import { formatPathsToRelative, formatToolInputPaths, perf, selectSpreadMessages, normalizePath } from '@craft-agent/shared/utils'
import { getCurrentLanguageName } from '@craft-agent/shared/i18n'
import { buildNovelSelectionRewritePrompt, sanitizeNovelSelectionReplacement } from '@craft-agent/shared/writing'
import { loadPiSkillCatalog } from '@craft-agent/shared/skills'
import { getMiniModel } from '@craft-agent/shared/config'
import { type ThinkingLevel, normalizeThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'
import { evaluateAutoLabels } from '@craft-agent/shared/labels/auto'
import { listLabels } from '@craft-agent/shared/labels/storage'
import { ensureLabelsExist } from '@craft-agent/shared/labels/crud'
import { AutomationSystem, canonicalizeSkillReferences, createPromptHistoryEntry, appendAutomationHistoryEntry } from '@craft-agent/shared/automations'
import { filterAttachmentsForModelInput } from './runtime-config'
import { captureWriteOriginalContent } from './write-original-content'
import {
  consumePendingSdkFork,
  createManagedSession,
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
  normalizeManagedDefaultGatewayAuthError,
} from './managed-gateway-auth-error'

// Import from server-core domain utilities
import { sanitizeForTitle, shouldActivateBrowserOverlay, rollbackFailedBranchCreation, releaseBrowserOwnershipOnForcedStop } from '@craft-agent/server-core/domain'
export { sanitizeForTitle }

// Host-injected singletons (logger/platform/runtime hooks) live in
// session-runtime.ts; re-exported here for host compatibility.
export { setSessionPlatform, setSessionRuntimeHooks } from './session-runtime'
import {
  getSessionLog,
  getSessionRuntimeHooks,
  getResourceProjectRoot,
  hasPersistedPiTranscript,
} from './session-runtime'
import { SessionBroadcaster } from './session-broadcaster'
import { ShareService } from './share-service'
import { MessageEdits } from './message-edits'
import { PlanTracking } from './plan-tracking'
import { SessionCrudMetadata } from './session-crud-metadata'
import { AuthFlow } from './auth-flow'
import { ExportImport } from './export-import'
import { buildServersFromSources, applyBridgeUpdates } from './source-bridge'
import { SessionPersistence } from './persistence'
import { AgentRuntimeLease } from './agent-runtime-lease'
import { AgentRuntime } from './agent-runtime'

export { AGENT_FLAGS } from './agent-runtime'

const MAX_ADMIN_REMEMBER_MINUTES = 60

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
  getSessionLog().debug('[OAuth] Checking if any tokens need refresh')

  const needRefresh = await tokenRefreshManager.getSourcesNeedingRefresh(sources)
  if (needRefresh.length === 0) {
    return { refreshedCount: 0, failedSources: [] }
  }

  getSessionLog().debug(`[OAuth] Refreshing ${needRefresh.length} source(s): ${needRefresh.map(s => s.config.slug).join(', ')}`)

  const { refreshed, failed } = await tokenRefreshManager.refreshSources(needRefresh)

  const failedSources = failed.map(({ source, reason }) => ({
    slug: source.config.slug,
    reason,
  }))

  return { refreshedCount: refreshed.length, failedSources }
}

// Managed-session factory moved to managed-session.ts; re-exported for host/test compatibility.
export { createManagedSession } from './managed-session'

export class SessionManager implements ISessionManager {
  private sessions: Map<string, ManagedSession> = new Map()
  /** Outbound event delivery — sole owner of the EventSink and delta batching state. */
  private broadcaster = new SessionBroadcaster()
  private shareService = new ShareService({
    getSession: id => this.sessions.get(id),
    broadcaster: this.broadcaster,
  })
  private messageEdits = new MessageEdits({
    getSession: id => this.sessions.get(id),
    persistSession: managed => this.persistSession(managed),
    broadcaster: this.broadcaster,
  })
  private planTracking = new PlanTracking({
    getSession: id => this.sessions.get(id),
  })
  private crudMetadata = new SessionCrudMetadata({
    getSession: id => this.sessions.get(id),
    allSessions: () => this.sessions.values(),
    persistSession: managed => this.persistSession(managed),
    flushSession: sessionId => this.flushSession(sessionId),
    sendEvent: (event, workspaceId) => this.sendEvent(event, workspaceId),
    emitUnreadSummaryChanged: () => this.emitUnreadSummaryChanged(),
    setMetadataWriteGuard: managed => this.setMetadataWriteGuard(managed),
    notifyFileChange: (workspaceRootPath, relativePath) =>
      this.configWatchers.get(workspaceRootPath)?.notifyFileChange(relativePath),
    getLastFinalOutputMessageId: messages => this.getLastFinalOutputMessageId(messages),
  })
  private authFlow = new AuthFlow({
    getSession: id => this.sessions.get(id),
    sendEvent: (event, workspaceId) => this.sendEvent(event, workspaceId),
    persistSession: managed => this.persistSession(managed),
    withAgentRuntimeLock: (managed, work, allowClosing) => this.withAgentRuntimeLock(managed, work, allowClosing),
    sendMessage: (sessionId, message, attachments, storedAttachments, options) =>
      this.sendMessage(sessionId, message, attachments, storedAttachments, options),
  })
  private exportImport = new ExportImport({
    getSession: id => this.sessions.get(id),
    hasSession: id => this.sessions.has(id),
    setSession: (id, managed) => this.sessions.set(id, managed),
    createSession: workspaceId => this.createSession(workspaceId),
    ensureMessagesLoaded: managed => this.ensureMessagesLoaded(managed),
    resolveManagedModelAccess: managed => this.resolveManagedModelAccess(managed),
    persistSession: managed => this.persistSession(managed),
    sendEvent: (event, workspaceId) => this.sendEvent(event, workspaceId),
    setInitialAutomationMetadata: (workspaceRootPath, sessionId, metadata) =>
      this.automationSystems.get(workspaceRootPath)?.setInitialSessionMetadata(sessionId, metadata),
  })
  private persistence = new SessionPersistence({
    getSession: id => this.sessions.get(id),
    setSession: (id, managed) => this.sessions.set(id, managed),
    onQueuedRecovery: sessionId => this.processNextQueuedMessage(sessionId),
    prepareBootServices: async () => {
      await this.reinitializeAuth()
      // Eagerly activate ConfigWatcher + AutomationSystem for every workspace so
      // the scheduler and event handlers start at boot — not lazily on first
      // client connect. This is critical for headless servers where no UI may
      // ever connect, yet scheduled/event-driven automations must still fire.
      const workspaces = getWorkspaces()
      for (const workspace of workspaces) {
        this.setupConfigWatcher(workspace.rootPath, workspace.id)
      }
      getSessionLog().info('Initialized workspace runtime services', { workspaceCount: workspaces.length })
    },
    setInitialAutomationMetadata: (workspaceRootPath, sessionId, metadata) =>
      this.automationSystems.get(workspaceRootPath)?.setInitialSessionMetadata(sessionId, metadata),
  })
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
  private privilegedExecutionBroker = new PrivilegedExecutionBroker(getSessionLog())
  // Session-local admin remember windows (exact command hash binding)
  private adminRememberApprovals: Map<string, {
    createdAt: number
    expiresAt: number
    sourceRequestId: string
  }> = new Map()
  // Message lazy-load dedup + startup init gate live in SessionPersistence (persistence).
  // O(1) index: taskId → sessionId for background task output lookup (avoids O(n) session scan)
  private taskOutputIndex: Map<string, string> = new Map()
  /** Serializes runtime acquisition and exclusive control-plane mutations per session. */
  // Per-session runtime mutex + shared-subprocess lease state live in AgentRuntimeLease.
  private agentLease = new AgentRuntimeLease({
    isSessionTracked: managed => this.sessions.get(managed.id) === managed,
    getOrCreateAgent: managed => this.getOrCreateAgentLocked(managed),
  })
  // Pi subprocess lifecycle (create/refresh/rotate/dispose) lives in AgentRuntime.
  private agentRuntime = new AgentRuntime({
    isSessionTracked: managed => this.sessions.get(managed.id) === managed,
    allSessions: () => [...this.sessions.values()],
    getAutomationSystem: workspaceRootPath => this.automationSystems.get(workspaceRootPath),
    withAgentRuntimeLock: (managed, work, allowClosing) => this.withAgentRuntimeLock(managed, work, allowClosing),
    tryRefreshAgentRuntimeLocked: (managed, reason) => this.tryRefreshAgentRuntimeLocked(managed, reason),
    sendEvent: (event, workspaceId) => this.sendEvent(event, workspaceId),
    persistSession: managed => this.persistSession(managed),
    handleConversationRewind: (managed, request) => this.handleConversationRewind(managed, request),
    monotonic: () => this.monotonic(),
    setProcessing: (managed, processing) => this.setProcessing(managed, processing),
    getBrowserPaneManager: () => this.browserPaneManager,
    hasActiveAdminRememberApproval: (sessionId, commandHash) =>
      this.hasActiveAdminRememberApproval(sessionId, commandHash),
    privilegedExecutionBroker: this.privilegedExecutionBroker,
    pendingPermissionRequests: this.pendingPermissionRequests,
    pendingUserQuestions: this.pendingUserQuestions,
    getAuthRequestDescription: request => this.getAuthRequestDescription(request),
    handlePlanSubmitted: (managed, planPath) => this.handlePlanSubmitted(managed, planPath),
    createSession: (workspaceId, options) => this.createSession(workspaceId, options),
    sendMessage: (sessionId, message, attachments) => this.sendMessage(sessionId, message, attachments),
    getSession: id => this.sessions.get(id),
    getSessions: workspaceId => this.getSessions(workspaceId),
    setSessionLabels: (sessionId, labels) => this.setSessionLabels(sessionId, labels),
    setSessionStatus: (sessionId, status) => this.setSessionStatus(sessionId, status),
  })
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
      getSessionRuntimeHooks().onSessionStarted()
    } else if (was && !processing) {
      getSessionRuntimeHooks().onSessionStopped()
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

    getSessionLog().warn('Turn watchdog timed out; forcing processing cleanup', {
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
      getSessionLog().error('Failed to stop processing after turn timeout:', error)
    })
  }

  /** Wait until initialize() has completed (sessions loaded from disk).
   *  Resolves immediately if already initialized. */
  waitForInit(scopeWorkspaceId?: string | null): Promise<void> {
    // ADR 0013: a scoped waiter only needs its own workspace's sessions indexed.
    return this.persistence.waitForInit(scopeWorkspaceId)
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

  setEventSink(sink: EventSink): void {
    this.broadcaster.setEventSink(sink)
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
      getSessionLog().info(`External metadata change detected for session ${sessionId}`)

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

    getSessionLog().debug(`Setting up ConfigWatcher for workspace: ${workspaceId} (${workspaceRootPath})`)
    const resourceProjectRoot = isFreeConversationWorkspaceId(workspaceId)
      ? undefined
      : workspaceRootPath

    const callbacks: ConfigWatcherCallbacks = {
      onSourcesListChange: async () => {
        const sources = loadWorkspaceSources(resourceProjectRoot)
        getSessionLog().info(`Sources list changed in ${workspaceRootPath} (${sources.length} sources)`)
        this.broadcastSourcesChanged(workspaceId, sources)
        await this.reloadSourcesForWorkspace(workspaceRootPath)
      },
      onSourceChange: async (slug: string, source: LoadedSource | null) => {
        getSessionLog().info(`Source '${slug}' changed:`, source ? 'updated' : 'deleted')
        const sources = loadWorkspaceSources(resourceProjectRoot)
        this.broadcastSourcesChanged(workspaceId, sources)
        await this.reloadSourcesForWorkspace(workspaceRootPath)
      },
      onSourceGuideChange: (sourceSlug: string) => {
        getSessionLog().info(`Source guide changed: ${sourceSlug}`)
        // Broadcast the updated sources list so sidebar picks up guide changes
        // Note: Guide changes don't require session source reload (no server changes)
        const sources = loadWorkspaceSources(resourceProjectRoot)
        this.broadcastSourcesChanged(workspaceId, sources)
      },
      onStatusConfigChange: () => {
        getSessionLog().info(`Status config changed in ${workspaceId}`)
        this.broadcastStatusesChanged(workspaceId)
      },
      onStatusIconChange: (_workspaceId: string, iconFilename: string) => {
        getSessionLog().info(`Status icon changed: ${iconFilename} in ${workspaceId}`)
        this.broadcastStatusesChanged(workspaceId)
      },
      onLabelConfigChange: () => {
        getSessionLog().info(`Label config changed in ${workspaceId}`)
        this.broadcastLabelsChanged(workspaceId)
        // Emit LabelConfigChange event via AutomationSystem
        const automationSystem = this.automationSystems.get(workspaceRootPath)
        if (automationSystem) {
          automationSystem.emitLabelConfigChange().catch((error) => {
            getSessionLog().error(`[Automations] Failed to emit LabelConfigChange:`, error)
          })
        }
      },
      onAutomationsConfigChange: () => {
        getSessionLog().info(`Automations config changed in ${workspaceId}`)
        // Reload automations config via AutomationSystem
        const automationSystem = this.automationSystems.get(workspaceRootPath)
        if (automationSystem) {
          const result = automationSystem.reloadConfig()
          if (result.errors.length === 0) {
            getSessionLog().info(`Reloaded ${result.automationCount} automations for workspace ${workspaceId}`)
          } else {
            getSessionLog().error(`Failed to reload automations for workspace ${workspaceId}:`, result.errors)
          }
        }
        // Notify renderer to re-read automations.json
        this.broadcastAutomationsChanged(workspaceId)
      },
      onLlmConnectionsChange: () => {
        getSessionLog().info(`LLM connections changed in ${workspaceId}`)
        this.broadcastLlmConnectionsChanged()
      },
      onAppThemeChange: (theme) => {
        getSessionLog().info(`App theme changed`)
        this.broadcastAppThemeChanged(theme)
      },
      onDefaultPermissionsChange: () => {
        getSessionLog().info('Default permissions changed')
        this.broadcastDefaultPermissionsChanged()
      },
      onSkillsChange: () => {
        getSessionLog().info(`Skills changed in ${workspaceRootPath}`)
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
              getSessionLog().info(`Deferred external metadata update for session ${sessionId} (recent programmatic write)`)
            } else {
              getSessionLog().info(`Deferred external metadata update for session ${sessionId} (processing active)`)
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
            getSessionLog().error(`[Automations] Failed to update session metadata:`, error)
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

            appendAutomationHistoryEntry(workspaceRootPath, entry).catch(e => getSessionLog().warn('[Automations] Failed to write history:', e))

            if (result.status === 'rejected') {
              getSessionLog().error(`[Automations] Failed to execute prompt action ${idx + 1}:`, result.reason)
            } else {
              getSessionLog().info(`[Automations] Created session ${result.value.sessionId} from prompt action`)
            }
          }
        },
        onError: (event, error) => {
          getSessionLog().error(`Automation failed for ${event}:`, error.message)
        },
      })
      this.automationSystems.set(workspaceRootPath, automationSystem)
      getSessionLog().debug(`Initialized AutomationSystem for workspace ${workspaceId}`)
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
          getSessionLog().info(`Skipping source reload for session ${managed.id} (processing)`)
          continue
        }
        await this.reloadSessionSources(managed)
      }
    }
  }

  private broadcastSourcesChanged(workspaceId: string, sources: LoadedSource[]): void {
    this.broadcaster.broadcastSourcesChanged(workspaceId, sources)
  }

  private broadcastStatusesChanged(workspaceId: string): void {
    this.broadcaster.broadcastStatusesChanged(workspaceId)
  }

  private broadcastLabelsChanged(workspaceId: string): void {
    this.broadcaster.broadcastLabelsChanged(workspaceId)
  }

  private broadcastAutomationsChanged(workspaceId: string): void {
    this.broadcaster.broadcastAutomationsChanged(workspaceId)
  }

  private broadcastAppThemeChanged(theme: import('@craft-agent/shared/config').ThemeOverrides | null): void {
    this.broadcaster.broadcastAppThemeChanged(theme)
  }

  private broadcastLlmConnectionsChanged(): void {
    this.broadcaster.broadcastLlmConnectionsChanged()
  }

  private broadcastSkillsChanged(workspaceId: string): void {
    this.broadcaster.broadcastSkillsChanged(workspaceId)
  }

  private broadcastDefaultPermissionsChanged(): void {
    this.broadcaster.broadcastDefaultPermissionsChanged()
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
      getSessionLog().info(`Reloading sources for session ${managed.id}`)

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

      getSessionLog().info(`Sources reloaded for session ${managed.id}: ${Object.keys(mcpServers).length} MCP, ${Object.keys(apiServers).length} API`)
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
   * (Delegates to AuthFlow.)
   *
   * @param connectionSlug - Optional connection slug to use (overrides default)
   */
  async reinitializeAuth(connectionSlug?: string): Promise<void> {
    await this.authFlow.reinitializeAuth(connectionSlug)
  }

  /** Boot the session subsystem: migrations, auth env, watchers, disk load, gate. (Delegates to SessionPersistence.) */
  async initialize(): Promise<void> {
    await this.persistence.initialize()
  }

  // Suppress fs.watch metadata-revert events for the window in which our own
  // atomic write completes. See onSessionMetadataChange.
  private setMetadataWriteGuard(managed: ManagedSession): void {
    managed._metadataWriteGuardUntil = Date.now() + METADATA_WRITE_GUARD_MS
  }

  /**
   * Persist a session to disk (async, with debouncing in the persistence queue).
   * (Delegates to SessionPersistence.)
   */
  private persistSession(managed: ManagedSession): void {
    this.persistence.persistSession(managed)
  }

  // Flush a specific session immediately (call on session close/switch). (Delegates to SessionPersistence.)
  async flushSession(sessionId: string): Promise<void> {
    await this.persistence.flushSession(sessionId)
  }

  // Flush all pending sessions (call on app quit). (Delegates to SessionPersistence.)
  async flushAllSessions(): Promise<void> {
    await this.persistence.flushAllSessions()
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
    getSessionLog().info(`Plan submitted for session ${managed.id}:`, planPath)
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
        getSessionLog().info(`Interrupting for plan submission in session ${managed.id}`)
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
      getSessionLog().error(`Failed to read plan file:`, error)
    }
  }

  // ============================================
  // Unified Auth Request Helpers
  // ============================================

  /**
   * Get human-readable description for auth request (delegates to AuthFlow).
   */
  private getAuthRequestDescription(request: AuthRequest): string {
    return this.authFlow.getAuthRequestDescription(request)
  }

  /**
   * Complete an auth request and send result back to agent
   * This updates the auth message status and sends a faked user message.
   * (Delegates to AuthFlow.)
   */
  async completeAuthRequest(sessionId: string, result: AuthResult): Promise<void> {
    await this.authFlow.completeAuthRequest(sessionId, result)
  }

  /**
   * Handle credential input from the UI (for non-OAuth auth)
   * Called when user submits credentials via the inline form.
   * (Delegates to AuthFlow.)
   */
  async handleCredentialInput(
    sessionId: string,
    requestId: string,
    response: import('@craft-agent/shared/protocol').CredentialResponse
  ): Promise<void> {
    await this.authFlow.handleCredentialInput(sessionId, requestId, response)
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
    void this.persistence.loadSessionsFromDisk()
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
    getSessionRuntimeHooks().updateBadgeCount(summary.totalUnreadSessions)
  }

  /**
   * Broadcast global unread summary to all workspace windows.
   */
  private emitUnreadSummaryChanged(): void {
    const summary = this.getUnreadSummary()

    // Update badge via runtime hook — host decides whether/how to render badges
    getSessionRuntimeHooks().updateBadgeCount(summary.totalUnreadSessions)

    // Broadcast to renderers for UI updates (session list dots, etc.)
    this.broadcaster.broadcastUnreadSummaryChanged(summary)
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
   * Ensure messages are loaded for a managed session. (Delegates to SessionPersistence.)
   */
  private async ensureMessagesLoaded(managed: ManagedSession): Promise<void> {
    await this.persistence.ensureMessagesLoaded(managed)
  }

  /**
   * Drop an idle session's in-memory transcript. (Delegates to SessionPersistence.)
   */
  async releaseIdleSessionMessages(sessionId: string): Promise<boolean> {
    return this.persistence.releaseIdleSessionMessages(sessionId)
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
        getSessionLog().warn('Branch validation failed: missing branchFromSessionId or branchFromMessageId', {
          workspaceId,
          branchFromSessionId: options.branchFromSessionId,
          branchFromMessageId: options.branchFromMessageId,
        })
        throw new Error('Invalid branch request: both branchFromSessionId and branchFromMessageId are required')
      }

      const sourceManaged = this.sessions.get(options.branchFromSessionId)
      if (sourceManaged) {
        if (sourceManaged.workspace.rootPath !== workspaceRootPath) {
          getSessionLog().warn('Branch validation failed: source session belongs to different workspace', {
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
        getSessionLog().warn('Branch validation failed: source session not found on disk', {
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
        getSessionLog().warn('Branch validation failed: source and target model providers are incompatible', {
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
        getSessionLog().warn('Branch validation failed: message not found in source session', {
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
          getSessionLog().warn('Pi branch anchor missing: rejecting unsafe SDK fork branch', {
            workspaceId,
            branchFromSessionId: options.branchFromSessionId,
            branchFromMessageId: options.branchFromMessageId,
          })
        }
      }

      if (branchContextStrategy === 'sdk-fork' && !branchFromSdkSessionId) {
        getSessionLog().warn('Branch validation failed: sdk-fork requires parent SDK session ID', {
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

      getSessionLog().info('Branch validation succeeded', {
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
      getSessionLog().info(`🤖 Creating mini agent session: model=${resolvedModel}, systemPromptPreset=${options?.systemPromptPreset}`)
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
          getSessionLog().warn('Branch creation failed during backend preflight handshake', {
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

      this.persistence.enqueuePersistStrict(managed)
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
        this.persistence.enqueuePersistStrict(managed)
        await this.flushSession(managed.id)
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], `Failed to rewind and restore product session ${managed.id}`)
      }
      throw error
    } finally {
      managed.rewindCommitInProgress = false
    }
  }

  /** Keep short pre-runtime session work ahead of deletion and invalidation. (Delegates to AgentRuntimeLease.) */
  private beginSessionOperationLease(managed: ManagedSession): () => void {
    return this.agentLease.beginSessionOperationLease(managed)
  }

  /** Serialize exclusive control-plane mutations per session. (Delegates to AgentRuntimeLease.) */
  private async withAgentRuntimeLock<T>(
    managed: ManagedSession,
    work: () => Promise<T>,
    allowClosing = false,
  ): Promise<T> {
    return this.agentLease.withAgentRuntimeLock(managed, work, allowClosing)
  }

  /** Retain one stable Pi subprocess for a compatible operation. (Delegates to AgentRuntimeLease.) */
  private async withAgentRuntimeLease<T>(
    managed: ManagedSession,
    work: (agent: AgentInstance) => Promise<T>,
  ): Promise<T> {
    return this.agentLease.withAgentRuntimeLease(managed, work)
  }

  /** Tear down a session's Pi runtime and MCP pool. (Delegates to AgentRuntime.) */
  private async disposeManagedAgentRuntime(managed: ManagedSession, reason: string): Promise<void> {
    await this.agentRuntime.disposeManagedAgentRuntime(managed, reason)
  }

  /** Refresh an existing agent's runtime config in place when signatures drift. (Delegates to AgentRuntime.) */
  private async tryRefreshAgentRuntime(managed: ManagedSession, reason: string): Promise<void> {
    await this.agentRuntime.tryRefreshAgentRuntime(managed, reason)
  }

  /** Send-path refresh; kept on the Facade so per-instance test stubs keep working. (Delegates to AgentRuntime.) */
  private async tryRefreshAgentRuntimeLocked(managed: ManagedSession, reason: string): Promise<void> {
    await this.agentRuntime.tryRefreshAgentRuntimeLocked(managed, reason)
  }

  /** Push a connection's runtime updates to every active session using it. (Delegates to AgentRuntime.) */
  async refreshConnectionRuntime(connectionSlug: string): Promise<void> {
    await this.agentRuntime.refreshConnectionRuntime(connectionSlug)
  }

  /** Push a rotated credential into every live backend using this connection. (Delegates to AgentRuntime.) */
  async reloadConnectionCredentials(
    connectionSlug: string,
    managedModelAccess?: ManagedModelAccess,
  ): Promise<void> {
    await this.agentRuntime.reloadConnectionCredentials(connectionSlug, managedModelAccess)
  }

  /** Revoke all live runtimes that still hold credentials for this connection. (Delegates to AgentRuntime.) */
  async disposeConnectionRuntimes(connectionSlug: string): Promise<void> {
    await this.agentRuntime.disposeConnectionRuntimes(connectionSlug)
  }

  // (Delegates to AgentRuntime.)
  private async ensureManagedCredentialForSessionLocked(
    managed: ManagedSession,
    forceRefresh = false,
  ): Promise<ManagedModelAccess | undefined> {
    return this.agentRuntime.ensureManagedCredentialForSessionLocked(managed, forceRefresh)
  }

  /** Resolve managed access without returning or mutating a live runtime. (Delegates to AgentRuntime.) */
  private async resolveManagedModelAccess(
    managed: ManagedSession,
    forceRefresh = false,
  ): Promise<ManagedModelAccess | undefined> {
    return this.agentRuntime.resolveManagedModelAccess(managed, forceRefresh)
  }

  /** Renew a rejected capability without mutating the reporting runtime. (Delegates to AgentRuntime.) */
  private async refreshManagedCredentialForNextTurn(managed: ManagedSession): Promise<void> {
    await this.agentRuntime.refreshManagedCredentialForNextTurn(managed)
  }

  /**
   * Get or create agent for a session (lazy loading). (Delegates to AgentRuntime.)
   * Kept on the Facade so the lease factory and per-instance test stubs resolve here.
   */
  private async getOrCreateAgentLocked(managed: ManagedSession): Promise<AgentInstance> {
    return this.agentRuntime.getOrCreateAgentLocked(managed)
  }

  /** Flag a session (delegates to SessionCrudMetadata). */
  async flagSession(sessionId: string): Promise<void> {
    await this.crudMetadata.flagSession(sessionId)
  }

  /** Unflag a session (delegates to SessionCrudMetadata). */
  async unflagSession(sessionId: string): Promise<void> {
    await this.crudMetadata.unflagSession(sessionId)
  }

  /** Archive a session (delegates to SessionCrudMetadata). */
  async archiveSession(sessionId: string): Promise<void> {
    await this.crudMetadata.archiveSession(sessionId)
  }

  /** Unarchive a session (delegates to SessionCrudMetadata). */
  async unarchiveSession(sessionId: string): Promise<void> {
    await this.crudMetadata.unarchiveSession(sessionId)
  }

  /** Set a session's workflow status (delegates to SessionCrudMetadata). */
  async setSessionStatus(sessionId: string, sessionStatus: SessionStatus): Promise<void> {
    await this.crudMetadata.setSessionStatus(sessionId, sessionStatus)
  }

  /** Set the LLM connection for a not-yet-started session (delegates to SessionCrudMetadata). */
  async setSessionConnection(sessionId: string, connectionSlug: string): Promise<void> {
    await this.crudMetadata.setSessionConnection(sessionId, connectionSlug)
  }

  // ============================================
  // Pending Plan Execution (Accept & Compact)
  // ============================================

  /** Set pending plan execution state (delegates to PlanTracking). */
  async setPendingPlanExecution(sessionId: string, planPath: string, draftInputSnapshot?: string): Promise<void> {
    await this.planTracking.setPendingPlanExecution(sessionId, planPath, draftInputSnapshot)
  }

  /** Mark compaction complete for pending plan execution (delegates to PlanTracking). */
  async markCompactionComplete(sessionId: string): Promise<void> {
    await this.planTracking.markCompactionComplete(sessionId)
  }

  /** Mark pending plan execution as dispatched from the UI (delegates to PlanTracking). */
  async markPendingPlanExecutionDispatched(sessionId: string): Promise<void> {
    await this.planTracking.markPendingPlanExecutionDispatched(sessionId)
  }

  /** Clear pending plan execution state (delegates to PlanTracking). */
  async clearPendingPlanExecution(sessionId: string): Promise<void> {
    await this.planTracking.clearPendingPlanExecution(sessionId)
  }

  /** Read pending plan execution state for a session (delegates to PlanTracking). */
  getPendingPlanExecution(sessionId: string): { planPath: string; draftInputSnapshot?: string; awaitingCompaction: boolean; executionDispatched: boolean } | null {
    return this.planTracking.getPendingPlanExecution(sessionId)
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
      getSessionLog().warn(`acceptPlan: session ${sessionId} not found`)
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

  /** Share session to the web viewer (delegates to ShareService). */
  async shareToViewer(sessionId: string): Promise<import('@craft-agent/shared/protocol').ShareResult> {
    return this.shareService.shareToViewer(sessionId)
  }

  /** Update an existing shared session (delegates to ShareService). */
  async updateShare(sessionId: string): Promise<import('@craft-agent/shared/protocol').ShareResult> {
    return this.shareService.updateShare(sessionId)
  }

  /** Revoke a shared session (delegates to ShareService). */
  async revokeShare(sessionId: string): Promise<import('@craft-agent/shared/protocol').ShareResult> {
    return this.shareService.revokeShare(sessionId)
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
      getSessionLog().info(`Setting sources for session ${sessionId}:`, sourceSlugs)

      // Clean up credential cache for sources being disabled (security)
      const previousSlugs = new Set(managed.enabledSourceSlugs || [])
      const newSlugs = new Set(sourceSlugs)
      const disabledSlugs = [...previousSlugs].filter(prevSlug => !newSlugs.has(prevSlug))
      if (disabledSlugs.length > 0) {
        try {
          await cleanupSourceRuntimeArtifacts(workspaceRootPath, disabledSlugs)
        } catch (err) {
          getSessionLog().warn(`Failed to clean up source runtime artifacts: ${err}`)
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
        if (errors.length > 0) getSessionLog().warn('Source build errors:', errors)

        const allSources = loadAllSources(projectRoot)
        agent.setAllSources(allSources)
        const usableSources = sources.filter(isSourceUsable)
        const intendedSlugs = usableSources.map(source => source.config.slug)
        await applyBridgeUpdates(agent, sessionPath, usableSources, mcpServers, managed.id, workspaceRootPath, 'source config change')
        await agent.setSourceServers(mcpServers, apiServers, intendedSlugs)

        getSessionLog().info(`Applied ${Object.keys(mcpServers).length} MCP + ${Object.keys(apiServers).length} API sources to active agent (${allSources.length} total)`)
      }

      this.persistSession(managed)
      this.sendEvent({
        type: 'sources_changed',
        sessionId,
        enabledSourceSlugs: sourceSlugs,
      }, managed.workspace.id)
      getSessionLog().info(`Session ${sessionId} sources updated: ${sourceSlugs.length} sources`)
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

  /** Track which session the user is actively viewing (delegates to SessionCrudMetadata). */
  setActiveViewingSession(sessionId: string | null, workspaceId: string): void {
    this.crudMetadata.setActiveViewingSession(sessionId, workspaceId)
  }

  /** Clear the actively-viewed session for a workspace (delegates to SessionCrudMetadata). */
  clearActiveViewingSession(workspaceId: string): void {
    this.crudMetadata.clearActiveViewingSession(workspaceId)
  }

  /**
   * Check if a session is currently being viewed by the user
   */
  private isSessionBeingViewed(sessionId: string, workspaceId: string): boolean {
    return this.crudMetadata.isSessionBeingViewed(sessionId, workspaceId)
  }

  /** Mark a session as read (delegates to SessionCrudMetadata). */
  async markSessionRead(sessionId: string): Promise<void> {
    await this.crudMetadata.markSessionRead(sessionId)
  }

  /** Mark a session as unread (delegates to SessionCrudMetadata). */
  async markSessionUnread(sessionId: string): Promise<void> {
    await this.crudMetadata.markSessionUnread(sessionId)
  }

  /** Mark all visible sessions in a workspace as read (delegates to SessionCrudMetadata). */
  async markAllSessionsRead(workspaceId: string): Promise<void> {
    await this.crudMetadata.markAllSessionsRead(workspaceId)
  }

  /** Rename a session (delegates to SessionCrudMetadata). */
  async renameSession(sessionId: string, name: string): Promise<void> {
    await this.crudMetadata.renameSession(sessionId, name)
  }

  /**
   * Regenerate the session title based on recent messages.
   * Uses the last few user messages to capture what the session has evolved into.
   * Automatically uses the same provider as the session (Claude or OpenAI).
   */
  async refreshTitle(sessionId: string): Promise<{ success: boolean; title?: string; error?: string }> {
    getSessionLog().info(`refreshTitle called for session ${sessionId}`)
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      getSessionLog().warn(`refreshTitle: Session ${sessionId} not found`)
      return { success: false, error: 'Session not found' }
    }

    // Ensure messages are loaded from disk (lazy loading support)
    await this.ensureMessagesLoaded(managed)

    // Select a spread of user messages (first, middle, last) to capture the session's purpose
    const allUserContents = managed.messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
    const userMessages = selectSpreadMessages(allUserContents)

    getSessionLog().info(`refreshTitle: Selected ${userMessages.length} spread messages from ${allUserContents.length} total`)

    if (userMessages.length === 0) {
      getSessionLog().warn(`refreshTitle: No user messages found`)
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

    try {
      getSessionLog().info(`refreshTitle: Calling agent.regenerateTitle...`)
      const title = await this.withAgentRuntimeLease(
        managed,
        async (agent) => {
          const title = await agent.regenerateTitle(userMessages, assistantResponse, { language: getCurrentLanguageName() })
          if (title) {
            managed.name = title
            this.persistSession(managed)
            this.sendEvent({ type: 'title_generated', sessionId, title }, managed.workspace.id)
          }
          return title
        },
      )
      getSessionLog().info(`refreshTitle: regenerateTitle returned: ${title ? `"${title}"` : 'null'}`)
      if (title) {
        getSessionLog().info(`Refreshed title for session ${sessionId}: "${title}"`)
        return { success: true, title }
      }
      return { success: false, error: 'Failed to generate title' }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      getSessionLog().error(`Failed to refresh title for session ${sessionId}:`, error)
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
   * (Delegates to SessionCrudMetadata.)
   */
  updateWorkingDirectory(sessionId: string, path: string): void {
    this.crudMetadata.updateWorkingDirectory(sessionId, path)
  }

  /**
   * Update the model for a session
   * Pass null to clear the session-specific model (will use global config)
   * @param connection - Optional LLM connection slug. Locked sessions may only
   * switch between transports in the app-managed model catalog.
   * (Delegates to SessionCrudMetadata.)
   */
  async updateSessionModel(sessionId: string, workspaceId: string, model: string | null, connection?: string): Promise<void> {
    await this.crudMetadata.updateSessionModel(sessionId, workspaceId, model, connection)
  }

  /** Update a message's content in place (delegates to MessageEdits). */
  updateMessageContent(sessionId: string, messageId: string, content: string): void {
    this.messageEdits.updateMessageContent(sessionId, messageId, content)
  }

  /** Add an annotation to a message (delegates to MessageEdits). */
  addMessageAnnotation(sessionId: string, messageId: string, annotation: NonNullable<Message['annotations']>[number]): void {
    this.messageEdits.addMessageAnnotation(sessionId, messageId, annotation)
  }

  /** Patch an existing annotation on a message (delegates to MessageEdits). */
  updateMessageAnnotation(
    sessionId: string,
    messageId: string,
    annotationId: string,
    patch: Partial<NonNullable<Message['annotations']>[number]>
  ): void {
    this.messageEdits.updateMessageAnnotation(sessionId, messageId, annotationId, patch)
  }

  /** Remove an annotation from a message (delegates to MessageEdits). */
  removeMessageAnnotation(sessionId: string, messageId: string, annotationId: string): void {
    this.messageEdits.removeMessageAnnotation(sessionId, messageId, annotationId)
  }

  async deleteSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      getSessionLog().warn(`Cannot delete session: ${sessionId} not found`)
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
          getSessionLog().warn(`Failed to revoke share for ${sessionId}: HTTP ${response.status}`)
        } else {
          getSessionLog().info(`Revoked share for deleted session ${sessionId}`)
        }
      } catch (error) {
        getSessionLog().warn(`Failed to revoke share for ${sessionId}:`, error)
      }
    }

    // Clean up delta flush timers to prevent orphaned timers
    this.broadcaster.clearSessionDeltas(sessionId)
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
    getSessionLog().info(`Deleted session ${sessionId}`)
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
      getSessionLog().warn('[queryOnce] managed auth failed; automatic replay is disabled', {
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
      getSessionLog().info('mid-stream send', {
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
      getSessionLog().warn(`Auto-label evaluation failed for session ${sessionId}:`, e)
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
            getSessionLog().warn(`Skill requires sources that are not usable (missing or unauthenticated): ${skipped.join(', ')}`)
          }

          if (toEnable.length > 0) {
            managed.enabledSourceSlugs = [...(managed.enabledSourceSlugs || []), ...toEnable]
            getSessionLog().info(`Pre-enabled sources for skill invocation: ${toEnable.join(', ')}`)
            this.persistSession(managed)
            this.sendEvent({
              type: 'sources_changed',
              sessionId,
              enabledSourceSlugs: managed.enabledSourceSlugs,
            }, managed.workspace.id)
          }
        }
      } catch (e) {
        getSessionLog().warn(`Failed to pre-enable skill sources for session ${sessionId}:`, e)
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
        getSessionLog().warn('[OAuth] Some sources failed token refresh:', refreshResult.failedSources.map(f => f.slug))
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
        getSessionLog().warn(`Source build errors:`, errors)
      }

      const mcpCount = Object.keys(mcpServers).length
      const apiCount = Object.keys(apiServers).length
      if (mcpCount > 0 || apiCount > 0 || enabledSlugs.length > 0) {
        const usableSources = sources.filter(isSourceUsable)
        const intendedSlugs = usableSources.map(s => s.config.slug)
        await agent.setSourceServers(mcpServers, apiServers, intendedSlugs)
        await applyBridgeUpdates(agent, sessionPath, usableSources, mcpServers, sessionId, workspaceRootPath, 'send message')
        getSessionLog().info(`Applied ${mcpCount} MCP + ${apiCount} API sources to session ${sessionId} (${allSources.length} total)`)
      }
      sendSpan.mark('servers.applied')
    }

      getSessionLog().info('Starting chat', {
        sessionId,
        workspaceId: managed.workspace.id,
        messageLength: message.length,
        attachmentCount: attachments?.length ?? 0,
        storedAttachmentCount: storedAttachments?.length ?? 0,
        model: agent.getModel(),
      })

      // Process the message through the agent
      getSessionLog().info('Calling agent.chat()...')
      if (attachments?.length) {
        getSessionLog().info('Attachments:', attachments.length)
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
        getSessionLog().info(`Omitting ${modelInputAttachments.omittedImages.length} image attachment(s) from model input for ${messageBackendContext.resolvedModel}: ${omittedNames}`)
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
      getSessionLog().info('Got chat iterator, starting iteration...')

      let hasMarkedFirstAgentEvent = false
      for await (const event of chatIterator) {
        if (!hasMarkedFirstAgentEvent) {
          sendSpan.mark('agent.first_event')
          hasMarkedFirstAgentEvent = true
        }
        if (turnWatchdog.getTimeout()) {
          getSessionLog().info('Dropping agent event after turn watchdog timeout', { sessionId, eventType: event.type })
          break
        }
        if (managed.processingGeneration !== myGeneration) {
          getSessionLog().info('Dropping stale agent event after newer generation started', { sessionId, eventType: event.type })
          break
        }
        // Log events (skip noisy text_delta)
        if (event.type !== 'text_delta') {
          if (event.type === 'tool_start') {
            getSessionLog().info(`tool_start: ${event.toolName} (${event.toolUseId})`)
          } else if (event.type === 'tool_result') {
            getSessionLog().info(`tool_result: ${event.toolUseId} isError=${event.isError}`)
          } else {
            getSessionLog().info('Got event:', event.type)
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
            getSessionLog().info(`Captured SDK session ID via fallback: ${sdkId}`)
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
            getSessionLog().info('Chat completed after explicit handoff/stop; skipping normal completion handling')
            sendSpan.mark('chat.complete.already_stopped')
            sendSpan.end()
            return
          }

          getSessionLog().info('Chat completed via complete event')

          // Check if we got an assistant response in this turn
          // If not, the SDK may have hit context limits or other issues
          const lastAssistantMsg = [...managed.messages].reverse().find(m =>
            m.role === 'assistant' && !m.isIntermediate
          )
          const lastUserMsg = [...managed.messages].reverse().find(m => m.role === 'user')

          // If the last user message is newer than any assistant response, we got no reply
          // This can happen due to context overflow or API issues
          if (lastUserMsg && (!lastAssistantMsg || lastUserMsg.timestamp > lastAssistantMsg.timestamp)) {
            getSessionLog().warn(`Session ${sessionId} completed without assistant response - possible context overflow or API issue`)

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
                content: apiError.message,
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
        getSessionLog().info('Chat loop exited after turn watchdog timeout')
        sendSpan.mark('chat.timeout')
        sendSpan.end()
      } else if (!managed.isProcessing) {
        getSessionLog().info('Chat loop exited after explicit handoff/stop')
        sendSpan.mark('chat.exit.already_stopped')
        sendSpan.end()
      } else if (managed.stopRequested) {
        getSessionLog().info('Chat loop completed after stop request - events drained successfully')
        await this.onProcessingStopped(sessionId, 'interrupted')
      } else {
        getSessionLog().info('Chat loop exited unexpectedly')
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

        getSessionLog().info(`Chat aborted (reason: ${reason || 'unknown'})`)
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
        getSessionLog().error('Error in chat:', error)
        getSessionLog().error('Error message:', error instanceof Error ? error.message : String(error))
        getSessionLog().error('Error stack:', error instanceof Error ? error.stack : 'No stack')

        // Report chat/SDK errors via runtime hooks (Electron can forward to Sentry)
        getSessionRuntimeHooks().captureException(error, { errorSource: 'chat', sessionId })

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
        getSessionLog().info('Finally block cleanup - unexpected exit')
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

    getSessionLog().info('Cancelling processing for session:', sessionId, silent ? '(silent)' : '')

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
        getSessionLog().warn('Generator did not complete after stop request, forcing cleanup')
        void this.onProcessingStopped(sessionId, 'timeout').catch(error => {
          getSessionLog().error('Failed to stop processing after cancel timeout:', error)
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

    getSessionLog().info('Sending queued message now:', {
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
        getSessionLog().warn('Generator did not complete after queued send-now request, forcing cleanup')
        void this.onProcessingStopped(sessionId, 'timeout').catch(error => {
          getSessionLog().error('Failed to stop queued processing after timeout:', error)
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

    getSessionLog().info(`Processing stopped for session ${sessionId}: ${reason}`)

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
      getSessionLog().info(`Auto-completing mini agent session ${sessionId}`)
      await this.setSessionStatus(sessionId, 'done')
    }

    // 4. Apply deferred external metadata updates captured while processing.
    if (managed.pendingExternalMetadata) {
      const pendingHeader = managed.pendingExternalMetadata
      managed.pendingExternalMetadata = undefined
      getSessionLog().info(`Applying deferred external metadata for session ${sessionId} after processing stop`)
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
    getSessionLog().info('replay queued', {
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
        getSessionLog().error('replay failed', {
          sessionId,
          messageId: next.messageId,
          error: err instanceof Error ? err.message : String(err),
        })
        // Report queued message failures via runtime hooks
        getSessionRuntimeHooks().captureException(err, { errorSource: 'chat-queue', sessionId })
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
          getSessionLog().error('Failed to stop processing after queued message failure:', error)
        })
      })
    })
  }

  async killShell(sessionId: string, shellId: string): Promise<{ success: boolean; error?: string }> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      return { success: false, error: 'Session not found' }
    }

    getSessionLog().info(`Killing shell ${shellId} for session: ${sessionId}`)

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

        getSessionLog().info(`Attempting to kill process with command: ${command.slice(0, 100)}...`)

        // Use pgrep first to find the PID, then kill it
        // This is safer than pkill -f which can match too broadly
        try {
          const { stdout } = await execAsync(`pgrep -f "${escapedCommand}"`)
          const pids = stdout.trim().split('\n').filter(Boolean)

          if (pids.length > 0) {
            getSessionLog().info(`Found ${pids.length} process(es) to kill: ${pids.join(', ')}`)
            // Kill each process
            for (const pid of pids) {
              try {
                await execAsync(`kill -TERM ${pid}`)
                getSessionLog().info(`Sent SIGTERM to process ${pid}`)
              } catch (killErr) {
                // Process may have already exited
                getSessionLog().warn(`Failed to kill process ${pid}: ${killErr}`)
              }
            }
          } else {
            getSessionLog().info(`No processes found matching command`)
          }
        } catch (pgrepErr) {
          // pgrep returns exit code 1 when no processes found, which is fine
          getSessionLog().info(`No matching processes found (pgrep returned no results)`)
        }

        // Clean up the stored command
        managed.backgroundShellCommands.delete(shellId)
      } catch (err) {
        getSessionLog().error(`Error killing shell process: ${err}`)
      }
    } else {
      getSessionLog().warn(`No command stored for shell ${shellId}, cannot kill process`)
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
      getSessionLog().info(`No output found for task: ${taskId} (task may still be running)`)
      return null
    }

    const managed = this.sessions.get(sessionId)
    const info = managed?.backgroundTaskOutputs.get(taskId)
    if (!info) {
      // Index out of sync — clean up stale entry
      this.taskOutputIndex.delete(taskId)
      return null
    }

    getSessionLog().info(`Found output for task ${taskId}: file=${info.outputFile}, status=${info.status}`)
    try {
      const content = await readFile(info.outputFile, 'utf-8')
      // Delete after successful read to prevent memory leak
      managed!.backgroundTaskOutputs.delete(taskId)
      this.taskOutputIndex.delete(taskId)
      return content
    } catch (err) {
      getSessionLog().error(`Failed to read task output file: ${info.outputFile}`, err)
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
          getSessionLog().warn(`Admin approval rejected by broker for ${requestId}: ${brokerResult.reason}`)
          // Broker rejection should fail closed.
          managed.agent.respondToPermission(requestId, false, false)
          return false
        }

        if (allowed && requestMeta.commandHash && options?.rememberForMinutes) {
          this.storeAdminRememberApproval(sessionId, requestMeta.commandHash, requestId, options.rememberForMinutes)
        }
      }

      getSessionLog().info(`Permission response for ${requestId}: allowed=${allowed}, alwaysAllow=${alwaysAllow}`)
      managed.agent.respondToPermission(requestId, allowed, alwaysAllow)
      return true
    } else {
      getSessionLog().warn(`Cannot respond to permission - no agent for session ${sessionId}`)
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
      getSessionLog().info(`Credential response (unified flow) for ${requestId}: cancelled=${response.cancelled}`)
      await this.handleCredentialInput(sessionId, requestId, response)
      return true
    }

    // Fall back to legacy callback flow
    const resolver = this.pendingCredentialResolvers.get(requestId)
    if (resolver) {
      getSessionLog().info(`Credential response (legacy flow) for ${requestId}: cancelled=${response.cancelled}`)
      resolver(response)
      this.pendingCredentialResolvers.delete(requestId)
      return true
    } else {
      getSessionLog().warn(`Cannot respond to credential - no pending request for ${requestId}`)
      return false
    }
  }

  /** Set the permission mode for a session (delegates to SessionCrudMetadata). */
  setSessionPermissionMode(sessionId: string, mode: PermissionMode): void {
    this.crudMetadata.setSessionPermissionMode(sessionId, mode)
  }

  /** Read authoritative permission-mode diagnostics for a session (delegates to SessionCrudMetadata). */
  getSessionPermissionModeState(sessionId: string): {
    permissionMode: PermissionMode
    previousPermissionMode?: PermissionMode
    transitionDisplay?: string
    modeVersion: number
    changedAt: string
    changedBy: 'user' | 'system' | 'restore' | 'automation' | 'unknown'
  } | null {
    return this.crudMetadata.getSessionPermissionModeState(sessionId)
  }

  /** Set labels for a session (delegates to SessionCrudMetadata). */
  async setSessionLabels(sessionId: string, labels: string[]): Promise<void> {
    await this.crudMetadata.setSessionLabels(sessionId, labels)
  }

  /** Set the sticky thinking level for a session (delegates to SessionCrudMetadata). */
  setSessionThinkingLevel(sessionId: string, level: ThinkingLevel): void {
    this.crudMetadata.setSessionThinkingLevel(sessionId, level)
  }

  /**
   * Generate an AI title for a session from the user's first message.
   * Uses the agent's generateTitle() method which handles provider-specific SDK calls.
   * If no agent exists, creates a temporary one using the session's connection.
   */
  private async generateTitle(managed: ManagedSession, userMessage: string): Promise<void> {
    getSessionLog().info(`[generateTitle] Starting for session ${managed.id}`)

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
        getSessionLog().info(`Generated title for session ${managed.id}: "${title}"`)
      } else {
        getSessionLog().warn(`Title generation returned null for session ${managed.id}`)
      }
    } catch (error) {
      getSessionLog().error(`Failed to generate title for session ${managed.id}:`, error)

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
              getSessionLog().warn(`Failed to persist Pi turn anchor for session ${sessionId}:`, error)
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

        getSessionLog().info(`RESULT MATCH: toolUseId=${event.toolUseId}, found=${!!existingToolMsg}, toolName=${existingToolMsg?.toolName || toolName}, wasComplete=${wasAlreadyComplete}`)

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
          getSessionLog().info(`RESULT WITHOUT START: toolUseId=${event.toolUseId}, toolName=${toolName} (creating message from result)`)
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
            getSessionLog().info(`CHILD AUTO-COMPLETED: toolUseId=${child.toolUseId}, toolName=${child.toolName} (parent ${toolName} completed)`)
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
          getSessionLog().info(`Session ${sessionId}: compaction complete, marked pending plan ready`)
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
          getSessionLog().info('Skipping error event after handoff/stop:', event.message)
          break
        }

        // Skip abort errors - these are expected when force-aborting via Query.close()
        if (event.message.includes('aborted') || event.message.includes('AbortError')) {
          getSessionLog().info('Skipping abort error event (expected during interrupt)')
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
          getSessionLog().info('Skipping typed_error event after handoff/stop:', event.error.message || event.error.title)
          break
        }

        // Skip abort errors - these are expected when force-aborting via Query.close()
        const typedErrorMsg = event.error.message || event.error.title || ''
        if (typedErrorMsg.includes('aborted') || typedErrorMsg.includes('AbortError')) {
          getSessionLog().info('Skipping typed abort error event (expected during interrupt)')
          break
        }
        const connectionSlug = resolveManagedConnectionSlug(managed)
        const typedError = normalizeManagedDefaultGatewayAuthError(event.error, connectionSlug)

        // Typed errors have structured information - send both formats for compatibility
        getSessionLog().info('typed_error:', JSON.stringify(typedError, null, 2))

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
          content: typedError.message || typedError.title || 'An error occurred',
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
          getSessionLog().info(`Background task ${event.taskId} completed (status=${event.status})`)

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
          getSessionLog().info(`Stored command for shell ${event.shellId}: ${event.command.slice(0, 50)}...`)
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
        getSessionLog().info(`Steer message undelivered, re-queuing for session ${sessionId}`)
        managed.messageQueue.push({ message: event.message })
        managed.wasInterrupted = true
        break

      // Note: working_directory_changed is user-initiated only (via updateWorkingDirectory),
      // the agent no longer has a change_working_directory tool
    }
  }

  private sendEvent(event: SessionEvent, workspaceId?: string): void {
    this.broadcaster.sendEvent(event, workspaceId)
  }

  /**
   * Queue a text delta for batched sending (performance optimization)
   * Instead of sending 50+ IPC events per second, batches deltas and flushes every 50ms
   */
  private queueDelta(sessionId: string, workspaceId: string, delta: string, turnId?: string): void {
    this.broadcaster.queueDelta(sessionId, workspaceId, delta, turnId)
  }

  /**
   * Flush any pending deltas for a session (sends batched IPC event)
   * Called on timer or when streaming ends (text_complete)
   */
  private flushDelta(sessionId: string, workspaceId: string): void {
    this.broadcaster.flushDelta(sessionId, workspaceId)
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
        getSessionLog().warn(`[Automations] llmConnection "${llmConnection}" not found, using default`)
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
        getSessionLog().warn('[Automations] automation binder threw', {
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
        getSessionLog().warn(`[Automations] Unknown mention: @${mention}`)
      }
    }

    return (sourceSlugs.length > 0 || skillSlugs.length > 0) ? { sourceSlugs, skillSlugs } : undefined
  }

  // ============================================
  // Export / Import / Dispatch
  // ============================================

  /** Export a summary payload for remote session transfer (delegates to ExportImport). */
  async exportRemoteSessionTransfer(sessionId: string, workspaceId: string): Promise<RemoteSessionTransferPayload | null> {
    return this.exportImport.exportRemoteSessionTransfer(sessionId, workspaceId)
  }

  /** Import a remote transfer payload as a new session (delegates to ExportImport). */
  async importRemoteSessionTransfer(
    workspaceId: string,
    payload: RemoteSessionTransferPayload,
  ): Promise<{ sessionId: string }> {
    return this.exportImport.importRemoteSessionTransfer(workspaceId, payload)
  }

  /**
   * Export a session as a portable SessionBundle. (Delegates to ExportImport.)
   */
  async exportSession(sessionId: string, workspaceId: string): Promise<SessionBundle | null> {
    return this.exportImport.exportSession(sessionId, workspaceId)
  }

  /**
   * Import a session bundle into a target workspace. (Delegates to ExportImport.)
   */
  async importSession(
    workspaceId: string,
    bundle: SessionBundle,
    mode: DispatchMode,
  ): Promise<{ sessionId: string; warnings?: string[] }> {
    return this.exportImport.importSession(workspaceId, bundle, mode)
  }

  /**
   * Clean up all resources held by the SessionManager.
   * Should be called on app shutdown to prevent resource leaks.
   */
  cleanup(): void {
    getSessionLog().info('Cleaning up resources...')
    const configWatcherCount = this.configWatchers.size
    const automationSystemCount = this.automationSystems.size

    // Stop all ConfigWatchers (file system watchers)
    for (const [path, watcher] of this.configWatchers) {
      watcher.stop()
      getSessionLog().debug(`Stopped config watcher for ${path}`)
    }
    this.configWatchers.clear()

    // Dispose all AutomationSystems (includes scheduler, handlers, and event loggers)
    for (const [workspacePath, automationSystem] of this.automationSystems) {
      try {
        automationSystem.dispose()
        getSessionLog().debug(`Disposed AutomationSystem for ${workspacePath}`)
      } catch (error) {
        getSessionLog().error(`Failed to dispose AutomationSystem for ${workspacePath}:`, error)
      }
    }
    this.automationSystems.clear()

    // Clear all pending delta flush timers
    this.broadcaster.dispose()

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

    getSessionLog().info('Cleanup complete', { configWatcherCount, automationSystemCount })
  }
}
