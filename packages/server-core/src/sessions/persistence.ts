// input: Session registry access, disk session stores, boot-service hooks, and a queue-recovery callback
// output: Startup initialization/gating, disk→memory session loading, debounced persistence, lazy message hydration, idle-release
// pos: Persistence subdomain under the SessionManager facade; owns initGate and message-loading dedup state

import { mkdirSync } from 'node:fs'
import {
  listSessionsAsync as listStoredSessions,
  loadSession as loadStoredSession,
  sessionPersistenceQueue,
  pickSessionFields,
  type StoredSession,
} from '@craft-agent/shared/sessions'
import { storedToMessage, messageToStored } from '@craft-agent/core/types'
import {
  setPermissionMode,
  hydratePreviousPermissionMode,
  type PermissionMode,
} from '@craft-agent/shared/agent'
import { resolveSessionConnection } from '@craft-agent/shared/agent/backend'
import {
  migrateLegacyCredentials,
  migrateLegacyLlmConnectionsConfig,
  migrateOrphanedDefaultConnections,
  normalizeLlmConnectionSlug,
  seedBuiltinLlmConnectionFromDefaults,
  getActiveWorkspace,
} from '@craft-agent/shared/config'
import {
  getFreeConversationWorkspace,
  isFreeConversationWorkspaceId,
  listSessionWorkspaces,
  loadWorkspaceConfig,
  resolveVerifiedWorkspaceWorkingDirectory,
} from '@craft-agent/shared/workspaces'
import { loadAllSources } from '@craft-agent/shared/sources'
import { InitGate, orderWorkspacesByActiveFirst } from '@craft-agent/server-core/domain'
import {
  createManagedSession,
  DEFAULT_TOKEN_USAGE,
  filterRestoredSourceSlugs,
  type ManagedSession,
} from './managed-session'
import type { InitialAutomationMetadata } from './export-import'
import { getSessionLog } from './session-runtime'

export interface PersistenceDeps {
  /** Registry lookups/mutations over the shared sessions map. */
  getSession: (sessionId: string) => ManagedSession | undefined
  setSession: (sessionId: string, managed: ManagedSession) => void
  deleteSession: (sessionId: string) => void
  /**
   * D→J edge: a hydrated transcript may contain orphaned queued messages from a
   * crash; the persistence layer re-queues them and hands dispatch back to the
   * Facade without knowing about message sending.
   */
  onQueuedRecovery: (sessionId: string) => void
  /** Boot services that stay in the Facade: auth env vars + per-workspace watchers/automations. */
  prepareBootServices: () => Promise<void>
  setInitialAutomationMetadata: (workspaceRootPath: string, sessionId: string, metadata: InitialAutomationMetadata) => void
}

export class SessionPersistence {
  // Deduplicates concurrent lazy loads of the same session's messages.
  private messageLoadingPromises: Map<string, Promise<void>> = new Map()
  private queuedRecoveryScheduled = new Set<string>()
  // Coordinates startup initialization waiters from IPC handlers.
  private initGate = new InitGate()

  constructor(private deps: PersistenceDeps) {}

  /** Wait until initialization has completed (optionally scoped to one workspace). */
  waitForInit(scopeWorkspaceId?: string | null): Promise<void> {
    return this.initGate.waitFor(scopeWorkspaceId)
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
      await this.deps.prepareBootServices()

      // Free Conversations is application-owned storage, so unlike user-owned
      // Project roots it is safe to create before fail-closed session discovery.
      mkdirSync(getFreeConversationWorkspace().rootPath, { recursive: true })

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
  async loadSessionsFromDisk(workspaceId?: string): Promise<void> {
    try {
      const workspaces = orderWorkspacesByActiveFirst(
        listSessionWorkspaces().filter(workspace => !workspaceId || workspace.id === workspaceId),
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
        const loadedSessionIds: string[] = []
        try {
          const workspaceRootPath = workspace.rootPath
          const sessionMetadata = await listStoredSessions(workspaceRootPath)
          // Load workspace config once per workspace for default working directory
          const wsConfig = loadWorkspaceConfig(workspaceRootPath)
          const wsDefaultWorkingDir = wsConfig?.defaults?.workingDirectory
          const workingDirectoryCache = new Map<string, string>()

          for (const meta of sessionMetadata) {
            const existing = this.deps.getSession(meta.id)
            if (existing) {
              if (existing.workspace.id !== workspace.id) {
                throw new Error(
                  `Session ${meta.id} is already registered to Project ${existing.workspace.id}`,
                )
              }
              continue
            }

            const requestedWorkingDirectory = meta.workingDirectory ?? wsDefaultWorkingDir
            const workingDirectoryKey = requestedWorkingDirectory ?? workspace.rootPath
            let workingDirectory = requestedWorkingDirectory
            if (!isFreeConversationWorkspaceId(workspace.id)) {
              workingDirectory = workingDirectoryCache.get(workingDirectoryKey)
              if (!workingDirectory) {
                workingDirectory = resolveVerifiedWorkspaceWorkingDirectory(
                  workspace,
                  workingDirectoryKey,
                  true,
                )
                workingDirectoryCache.set(workingDirectoryKey, workingDirectory)
              }
            }

            // Create managed session from metadata only (messages lazy-loaded on demand)
            const managed = createManagedSession(meta, workspace, {
              enabledSourceSlugs: undefined,
              workingDirectory,
            })

            // Migration: clear orphaned llmConnection references (e.g., after connection was deleted)
            if (managed.llmConnection) {
              const conn = resolveSessionConnection(managed.llmConnection, undefined)
              if (!conn) {
                getSessionLog().warn(`Session ${meta.id} has orphaned llmConnection "${managed.llmConnection}", clearing`)
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

            this.deps.setSession(meta.id, managed)
            loadedSessionIds.push(meta.id)

            // Initialize session metadata in AutomationSystem for diffing
            this.deps.setInitialAutomationMetadata(workspaceRootPath, meta.id, {
              permissionMode: meta.permissionMode,
              labels: meta.labels,
              isFlagged: meta.isFlagged,
              sessionStatus: meta.sessionStatus,
              sessionName: managed.name,
            })

            totalSessions++
            sessionsSinceYield++
            if (sessionsSinceYield >= 100) {
              sessionsSinceYield = 0
              await new Promise<void>((resolve) => setImmediate(resolve))
            }
          }

          this.initGate.markScopeReady(workspace.id)
        } catch (error) {
          for (const sessionId of loadedSessionIds) this.deps.deleteSession(sessionId)
          totalSessions -= loadedSessionIds.length
          this.initGate.markScopeFailed(workspace.id, error)
          getSessionLog().error(`Failed to index Sessions for Project ${workspace.id}:`, error)
          if (workspaceId) throw error
        }

        // listStoredSessions() is synchronous per workspace. Yield between
        // roots so workspace/file RPCs remain responsive during restoration.
        await new Promise<void>((resolve) => setImmediate(resolve))
      }

      getSessionLog().info(`Loaded ${totalSessions} sessions from disk (metadata only)`, {
        permissionModes: permissionModeCounts,
      })
    } catch (error) {
      getSessionLog().error('Failed to load sessions from disk:', error)
      throw error
    }
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
  persistSession(managed: ManagedSession): void {
    if (this.deps.getSession(managed.id) !== managed) return
    if (managed.runtimeState) return
    if (!managed.messagesLoaded) {
      this.hydrateMessagesForColdPersist(managed)
    }
    this.enqueuePersist(managed)
  }

  // Cold-persist hydration. Mirrors the messages/queue-recovery half of
  // loadMessagesFromDisk but skips the metadata field syncs. Sets
  // messagesLoaded=true so subsequent persistSession calls take the fast path.
  // Normal cold persists also recover queued work. Project lifecycle callers
  // opt out so snapshot hydration cannot start runtime work mid-transition.
  private hydrateMessagesForColdPersist(
    managed: ManagedSession,
    recoverQueuedMessages = true,
  ): void {
    getSessionLog().debug(`Cold-load triggered for persistSession on ${managed.id}`)
    const stored = loadStoredSession(managed.workspace.rootPath, managed.id)
    if (!stored) {
      throw new Error(`Cannot persist cold Session ${managed.id}: its durable transcript is unavailable.`)
    }
    managed.messages = (stored.messages || []).map(storedToMessage)
    managed.tokenUsage = stored.tokenUsage
    // Deferred-load fields (intentionally undefined after startup, see
    // loadSessionsFromDisk). Populate from disk only if not already set in
    // memory — a caller may have mutated them via setSessionSources etc.
    if (managed.enabledSourceSlugs === undefined) {
      managed.enabledSourceSlugs = this.restoreEnabledSourceSlugs(managed, stored.enabledSourceSlugs)
    }
    if (managed.lastReadMessageId === undefined) managed.lastReadMessageId = stored.lastReadMessageId
    if (managed.hasUnread === undefined) managed.hasUnread = stored.hasUnread
    if (managed.sharedUrl === undefined) managed.sharedUrl = stored.sharedUrl
    if (managed.sharedId === undefined) managed.sharedId = stored.sharedId
    if (managed.transferredSessionSummary === undefined) managed.transferredSessionSummary = stored.transferredSessionSummary
    if (managed.transferredSessionSummaryApplied === undefined) managed.transferredSessionSummaryApplied = stored.transferredSessionSummaryApplied

    if (recoverQueuedMessages) this.recoverOrphanedQueuedMessages(managed)
    getSessionLog().debug(`Cold-hydrated ${managed.messages.length} messages for session ${managed.id}`)
    managed.messagesLoaded = true
  }

  private restoreEnabledSourceSlugs(
    managed: ManagedSession,
    storedSlugs: readonly string[] | undefined,
    projectRootOverride?: string,
  ): string[] | undefined {
    const projectRoot = isFreeConversationWorkspaceId(managed.workspace.id)
      ? undefined
      : projectRootOverride ?? managed.workspace.rootPath
    return filterRestoredSourceSlugs(
      managed.workspace,
      storedSlugs,
      loadAllSources(projectRoot, managed.workspace.id),
    )
  }

  // Shared by both hydration paths: find orphaned queued messages from
  // crash/restart, re-queue them, and hand dispatch back to the Facade.
  recoverOrphanedQueuedMessages(managed: ManagedSession): void {
    const queuedMessageIds = new Set(managed.messageQueue.map(message => message.messageId))
    const orphanedQueued = managed.messages.filter(m =>
      m.role === 'user' && m.isQueued === true && !queuedMessageIds.has(m.id)
    )
    if (orphanedQueued.length > 0) {
      getSessionLog().info(`Recovering ${orphanedQueued.length} queued message(s) for session ${managed.id}`)
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
    }
    // Use setImmediate to avoid blocking the load and allow session state to settle.
    // Project lifecycle hydration is passive; relink resumes only after its transition commits.
    if (
      !managed.runtimeState
      && !managed.isProcessing
      && managed.messageQueue.length > 0
      && !this.queuedRecoveryScheduled.has(managed.id)
    ) {
      this.queuedRecoveryScheduled.add(managed.id)
      setImmediate(() => {
        this.queuedRecoveryScheduled.delete(managed.id)
        this.deps.onQueuedRecovery(managed.id)
      })
    }
  }

  // Build the StoredSession snapshot and hand it to the persistence queue.
  // Caller must ensure `managed.messagesLoaded` is true.
  private enqueuePersist(managed: ManagedSession): void {
    try {
      this.enqueuePersistStrict(managed)
    } catch (error) {
      getSessionLog().error(`Failed to queue session ${managed.id} for persistence:`, error)
    }
  }

  /**
   * Enqueue a snapshot without the cold-hydrate/identity preflight — for callers
   * that have already mutated state and need the exact current transcript written
   * (e.g. rewind commit).
   */
  enqueuePersistStrict(managed: ManagedSession): void {
    if (managed.runtimeState === 'deleting') return
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

  /** Persist the lifecycle owner's final snapshot while ordinary invalidating writes are fenced. */
  enqueueProjectInvalidationSnapshot(managed: ManagedSession): void {
    if (managed.runtimeState !== 'invalidating') {
      throw new Error(`Session ${managed.id} is not owned by a Project invalidation`)
    }
    if (!managed.messagesLoaded) this.hydrateMessagesForColdPersist(managed, false)
    this.enqueuePersistStrict(managed)
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

  /**
   * Ensure messages are loaded for a managed session.
   * Uses promise deduplication to prevent race conditions when multiple
   * concurrent calls (e.g., rapid session switches + message send) try
   * to load messages simultaneously.
   */
  async ensureMessagesLoaded(managed: ManagedSession): Promise<void> {
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
    const managed = this.deps.getSession(sessionId)
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
    getSessionLog().debug(`Released ${dropped} in-memory messages for idle session ${sessionId}`)
    return true
  }

  /**
   * Internal: Load messages from disk storage into the managed session.
   */
  private async loadMessagesFromDisk(managed: ManagedSession): Promise<void> {
    const storedSession = loadStoredSession(managed.workspace.rootPath, managed.id)
    if (!storedSession) {
      throw new Error(`Cannot load cold Session ${managed.id}: its durable transcript is unavailable.`)
    }
    this.hydrateMessages(managed, storedSession)
  }

  /** Hydrate a cold Session from a validated relink target, never the missing old root. */
  hydrateMessagesFromRoot(
    managed: ManagedSession,
    rootPath: string,
    recoverQueuedMessages = true,
  ): void {
    const storedSession = loadStoredSession(rootPath, managed.id)
    if (!storedSession || storedSession.id !== managed.id) {
      throw new Error(`The selected Project does not contain readable Session ${managed.id}.`)
    }
    this.hydrateMessages(managed, storedSession, rootPath, recoverQueuedMessages)
  }

  private hydrateMessages(
    managed: ManagedSession,
    storedSession: StoredSession,
    projectRootOverride?: string,
    recoverQueuedMessages = true,
  ): void {
    managed.messages = (storedSession.messages || []).map(storedToMessage)
    managed.tokenUsage = storedSession.tokenUsage
    managed.lastReadMessageId = storedSession.lastReadMessageId
    managed.hasUnread = storedSession.hasUnread
    managed.enabledSourceSlugs = this.restoreEnabledSourceSlugs(
      managed,
      storedSession.enabledSourceSlugs,
      projectRootOverride,
    )
    managed.sharedUrl = storedSession.sharedUrl
    managed.sharedId = storedSession.sharedId
    managed.name = storedSession.name
    if (storedSession.llmConnection) {
      managed.llmConnection = normalizeLlmConnectionSlug(storedSession.llmConnection)
    }
    if (storedSession.connectionLocked) {
      managed.connectionLocked = storedSession.connectionLocked
    }
    managed.transferredSessionSummary = storedSession.transferredSessionSummary
    managed.transferredSessionSummaryApplied = storedSession.transferredSessionSummaryApplied
    managed.messagesLoaded = true
    getSessionLog().debug(`Lazy-loaded ${managed.messages.length} messages for session ${managed.id}`)
    if (recoverQueuedMessages) this.recoverOrphanedQueuedMessages(managed)
  }
}
