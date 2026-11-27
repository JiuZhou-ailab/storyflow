/**
 * input: Workspace storage directory, optional legacy directory, and binding mutations
 * output: Persisted channel bindings and change notifications on successful writes
 * pos: Workspace messaging bindings.json persistence
 *
 * Stores bindings in an explicit storage directory (passed by the caller).
 * In Electron this is `~/.craft-agent/workspaces/{wsId}/messaging/`, but tests
 * can point it at any directory.
 *
 * One-shot migration: if a legacy path is provided and contains a bindings.json
 * that the new path does not, the legacy file is copied forward on construction.
 */

import {
  readFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { atomicWriteFileSync } from '@craft-agent/shared/utils'
import type { ChannelBinding, MessagingLogger, PlatformType } from './types'
import { normalizeBindingConfig } from './types'

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

export class BindingStore {
  private bindings: ChannelBinding[] = []
  private readonly filePath: string
  private readonly dirPath: string
  private readonly log: MessagingLogger
  private changeListener?: () => void

  /**
   * @param storageDir  Absolute path to the directory where bindings.json is stored.
   * @param legacyDir   Optional legacy directory. If its bindings.json exists and
   *                    the new location does not, the file is copied forward once.
   */
  constructor(storageDir: string, legacyDir?: string, logger: MessagingLogger = NOOP_LOGGER) {
    this.dirPath = storageDir
    this.filePath = join(storageDir, 'bindings.json')
    this.log = logger
    this.migrateLegacy(legacyDir)
    this.load()
  }

  /** Register a callback fired after any mutation is persisted. */
  onChange(fn: () => void): void {
    this.changeListener = fn
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  /**
   * Find the active binding for a (platform, channelId, threadId) tuple.
   * `threadId` distinguishes Telegram supergroup forum topics from each
   * other and from the supergroup's General topic / DMs (undefined).
   *
   * Bindings created without `threadId` (DMs, pre-topics-feature data)
   * only match calls passing `threadId === undefined`.
   */
  findByChannel(platform: PlatformType, channelId: string, threadId?: number): ChannelBinding | undefined {
    return this.bindings.find(
      (b) =>
        b.platform === platform &&
        b.channelId === channelId &&
        (b.threadId ?? undefined) === threadId &&
        b.enabled,
    )
  }

  findBySession(sessionId: string): ChannelBinding[] {
    return this.bindings.filter((b) => b.sessionId === sessionId && b.enabled)
  }

  getAll(): ChannelBinding[] {
    return [...this.bindings]
  }

  // -------------------------------------------------------------------------
  // Mutation
  // -------------------------------------------------------------------------

  bind(
    workspaceId: string,
    sessionId: string,
    platform: PlatformType,
    channelId: string,
    channelName?: string,
    config?: Partial<ChannelBinding['config']>,
    threadId?: number,
  ): ChannelBinding {
    // One channel → one session: evict any existing binding for the
    // (platform, channelId, threadId) tuple. Different topics in the same
    // supergroup are independently bindable.
    const remaining = this.bindings.filter(
      (b) => !(b.platform === platform && b.channelId === channelId && (b.threadId ?? undefined) === threadId),
    )

    const binding: ChannelBinding = {
      id: randomUUID(),
      workspaceId,
      sessionId,
      platform,
      channelId,
      ...(threadId !== undefined ? { threadId } : {}),
      channelName,
      enabled: true,
      createdAt: Date.now(),
      config: normalizeBindingConfig(platform, config),
    }

    this.commit([...remaining, binding])
    this.log.info('binding created', {
      event: 'binding_created',
      workspaceId,
      sessionId,
      platform,
      channelId,
      threadId,
      bindingId: binding.id,
      channelName,
    })
    return binding
  }

  /**
   * Update a binding's `BindingConfig` while preserving `id`,
   * `createdAt`, `channelId`, etc. Returns the updated binding (or null
   * if the id wasn't found).
   *
   * Use this instead of `bind()` when you only need to change config
   * fields like `accessMode` or `allowedSenderIds`. `bind()` evicts and
   * re-creates with a fresh UUID, which silently rotates the binding id
   * and breaks anything keyed on it (audit logs, deep links, stale UI
   * closures).
   */
  updateBindingConfig(bindingId: string, patch: Partial<ChannelBinding['config']>): ChannelBinding | null {
    const binding = this.bindings.find((b) => b.id === bindingId)
    if (!binding) return null
    const next = {
      ...binding,
      config: normalizeBindingConfig(binding.platform, { ...binding.config, ...patch }),
    }
    this.commit(this.bindings.map((b) => b === binding ? next : b))
    this.log.info('binding config updated', {
      event: 'binding_config_updated',
      bindingId,
      platform: binding.platform,
      patchedKeys: Object.keys(patch),
    })
    return next
  }

  /** Persist the lock-down migration in one write. The registry publishes
   * the change after committing the workspace access mode. */
  migrateOpenBindingsToInherit(platform: PlatformType): void {
    let changed = false
    const next = this.bindings.map<ChannelBinding>((binding) => {
      if (binding.platform !== platform || binding.config.accessMode !== 'open') return binding
      changed = true
      return { ...binding, config: { ...binding.config, accessMode: 'inherit', allowedSenderIds: [] } }
    })
    if (changed) this.save(next)
  }

  unbind(platform: PlatformType, channelId: string, threadId?: number): boolean {
    const before = this.bindings.length
    const remaining = this.bindings.filter(
      (b) => !(b.platform === platform && b.channelId === channelId && (b.threadId ?? undefined) === threadId),
    )
    if (remaining.length !== before) {
      this.commit(remaining)
      this.log.info('binding removed by channel', {
        event: 'binding_removed',
        platform,
        channelId,
        threadId,
      })
      return true
    }
    return false
  }

  unbindById(bindingId: string): boolean {
    const binding = this.bindings.find((b) => b.id === bindingId)
    if (!binding) return false
    this.commit(this.bindings.filter((b) => b.id !== bindingId))
    this.log.info('binding removed by id', {
      event: 'binding_removed',
      bindingId,
      workspaceId: binding.workspaceId,
      sessionId: binding.sessionId,
      platform: binding.platform,
      channelId: binding.channelId,
    })
    return true
  }

  unbindSession(sessionId: string, platform?: PlatformType): number {
    const removedBindings = this.bindings.filter((b) => {
      if (b.sessionId !== sessionId) return false
      if (platform && b.platform !== platform) return false
      return true
    })
    if (removedBindings.length === 0) return 0

    this.commit(this.bindings.filter((b) => !removedBindings.includes(b)))
    this.log.info('bindings removed by session', {
      event: 'binding_removed',
      sessionId,
      platform,
      removedCount: removedBindings.length,
      bindingIds: removedBindings.map((b) => b.id),
    })
    return removedBindings.length
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private migrateLegacy(legacyDir?: string): void {
    if (!legacyDir) return
    const legacyFile = join(legacyDir, 'bindings.json')
    if (existsSync(this.filePath)) return
    if (!existsSync(legacyFile)) return
    try {
      if (!existsSync(this.dirPath)) {
        mkdirSync(this.dirPath, { recursive: true })
      }
      copyFileSync(legacyFile, this.filePath)
      this.log.info('bindings migrated from legacy location', {
        event: 'bindings_migrated',
        legacyFile,
        filePath: this.filePath,
      })
    } catch (err) {
      this.log.error('binding migration failed', {
        event: 'bindings_migration_failed',
        legacyFile,
        filePath: this.filePath,
        error: err,
      })
    }
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8')
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          this.bindings = parsed.map(normalizeBinding)
        }
      }
    } catch (err) {
      this.log.error('failed to load bindings store; resetting to empty', {
        event: 'bindings_load_failed',
        filePath: this.filePath,
        error: err,
      })
      this.bindings = []
    }
  }

  private commit(bindings: ChannelBinding[]): void {
    this.save(bindings)
    this.changeListener?.()
  }

  private save(bindings: ChannelBinding[]): void {
    try {
      if (!existsSync(this.dirPath)) {
        mkdirSync(this.dirPath, { recursive: true })
      }
      atomicWriteFileSync(this.filePath, JSON.stringify(bindings, null, 2))
    } catch (err) {
      this.log.error('failed to save bindings store', {
        event: 'bindings_save_failed',
        filePath: this.filePath,
        error: err,
      })
      throw new Error('Failed to save messaging bindings.', { cause: err })
    }
    this.bindings = bindings
  }
}

// ---------------------------------------------------------------------------
// Migration helpers
// ---------------------------------------------------------------------------

function normalizeBinding(raw: ChannelBinding): ChannelBinding {
  return {
    ...raw,
    config: normalizeBindingConfig(raw.platform, raw.config ?? {}),
  }
}
