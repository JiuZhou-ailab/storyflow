// input: Project-owned JSONL retry queue, clock, and webhook results
// output: Deferred retry execution, atomic queue updates, and terminal attempt history
// pos: Owns scheduled webhook retries and serializes Project retry queue mutations

/**
 * RetryScheduler - Persistent retry queue for failed webhooks
 *
 * When immediate retries (seconds-scale) are exhausted and a webhook still fails,
 * it's added to a persistent JSONL queue file. The scheduler checks the queue
 * every 60 seconds and retries at increasing intervals:
 *   - 1st deferred: 5 minutes
 *   - 2nd deferred: 30 minutes
 *   - 3rd deferred: 1 hour
 *
 * After all deferred attempts fail, the entry is removed and a final history
 * entry is written. Queue entries survive app restarts.
 */

import { randomUUID } from 'node:crypto';
import { readFile, appendFile, open, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'path';
import { createLogger } from '../utils/debug.ts';
import { executeWebhookRequest, createWebhookHistoryEntry } from './webhook-utils.ts';
import { AUTOMATIONS_RETRY_QUEUE_FILE } from './constants.ts';
import { appendAutomationHistoryEntry } from './history-store.ts';
import { resolveAutomationOwnedPath } from './resolve-config-path.ts';
import type { WebhookAction, WebhookActionResult } from './types.ts';

const log = createLogger('retry-scheduler');

// Deferred retry delays: 5m, 30m, 1h
const DEFERRED_DELAYS_MS = [
  5 * 60_000,    // 5 minutes
  30 * 60_000,   // 30 minutes
  60 * 60_000,   // 1 hour
];

const MAX_DEFERRED_ATTEMPTS = DEFERRED_DELAYS_MS.length;

/** Queue tick interval (how often we check the queue file) */
const TICK_INTERVAL_MS = 60_000; // 1 minute

const queueMutations = new Map<string, Promise<void>>();

/** Serialize every read-modify-write and append for one durable retry queue. */
export function withRetryQueueMutation<T>(
  workspaceRootPath: string,
  mutate: () => T | Promise<T>,
): Promise<T> {
  const key = resolve(workspaceRootPath);
  const previous = queueMutations.get(key) ?? Promise.resolve();
  const next = previous.then(mutate, mutate);
  queueMutations.set(key, next.then(() => {}, () => {}));
  return next;
}

// ============================================================================
// Queue Entry
// ============================================================================

export interface RetryQueueEntry {
  /** Unique entry ID */
  id: string;
  /** Matcher ID (for history correlation) */
  matcherId: string;
  /** The webhook action with expanded values (no env vars needed at retry time) */
  action: WebhookAction;
  /** Expanded URL (post-env-expansion) for safe logging */
  expandedUrl: string;
  /** Number of deferred attempts already made (0 = first deferred pending) */
  deferredAttempt: number;
  /** Timestamp when the next retry should happen */
  nextRetryAt: number;
  /** Timestamp when this entry was created */
  createdAt: number;
  /** Last error message */
  lastError?: string;
}

// ============================================================================
// RetryScheduler
// ============================================================================

export interface RetrySchedulerOptions {
  workspaceRootPath: string;
}

export class RetryScheduler {
  private readonly workspaceRootPath: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlightTick: Promise<void> | null = null;

  constructor(options: RetrySchedulerOptions) {
    this.workspaceRootPath = options.workspaceRootPath;
  }

  /**
   * Start the scheduler. Checks queue every minute.
   */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    log.debug('[RetryScheduler] Started');
    // Run an initial tick after a short delay (don't block startup)
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      void this.tick();
    }, 5_000);
  }

  /**
   * Stop the scheduler and clean up.
   */
  async dispose(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    await this.inFlightTick;
    log.debug('[RetryScheduler] Disposed');
  }

  /**
   * Enqueue a failed webhook for deferred retry.
   * Called by WebhookHandler when immediate retries are exhausted.
   */
  async enqueue(
    matcherId: string,
    action: WebhookAction,
    expandedUrl: string,
    lastError?: string,
  ): Promise<void> {
    await withRetryQueueMutation(this.workspaceRootPath, async () => {
      const entry: RetryQueueEntry = {
        id: `${matcherId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        matcherId,
        action,
        expandedUrl,
        deferredAttempt: 0,
        nextRetryAt: Date.now() + DEFERRED_DELAYS_MS[0]!,
        createdAt: Date.now(),
        lastError,
      };

      const queuePath = resolveAutomationOwnedPath(
        this.workspaceRootPath,
        join(this.workspaceRootPath, AUTOMATIONS_RETRY_QUEUE_FILE),
      );
      await appendFile(queuePath, JSON.stringify(entry) + '\n', 'utf-8');
      log.debug(`[RetryScheduler] Enqueued ${entry.id} — next retry in ${DEFERRED_DELAYS_MS[0]! / 60_000}m`);
    });
  }

  /**
   * Process the queue and persist changes made by due retries.
   */
  private tick(): Promise<void> {
    if (this.inFlightTick) return this.inFlightTick;

    const tick = this.processQueue().finally(() => {
      if (this.inFlightTick === tick) {
        this.inFlightTick = null;
      }
    });
    this.inFlightTick = tick;
    return tick;
  }

  private processQueue(): Promise<void> {
    // ponytail: hold the per-Project queue lock across retries (up to 30s per webhook);
    // split read/commit only if concurrent enqueue timings show user-visible waits caused
    // by this lock, preserving durable entries and preventing duplicate retry execution.
    return withRetryQueueMutation(this.workspaceRootPath, async () => {
      try {
      const queuePath = resolveAutomationOwnedPath(
        this.workspaceRootPath,
        join(this.workspaceRootPath, AUTOMATIONS_RETRY_QUEUE_FILE),
      );

      // Read queue
      let raw: string;
      try {
        raw = await readFile(queuePath, 'utf-8');
      } catch {
        // No queue file — nothing to do
        return;
      }

      const lines = raw.trim().split('\n').filter(Boolean);
      if (lines.length === 0) return;

      const entries: RetryQueueEntry[] = [];
      for (const line of lines) {
        try {
          entries.push(JSON.parse(line) as RetryQueueEntry);
        } catch {
          // Skip malformed lines
        }
      }

      if (entries.length === 0) return;

      const now = Date.now();
      const remaining: RetryQueueEntry[] = [];
      let changed = false;

      for (const entry of entries) {
        if (entry.nextRetryAt > now) {
          // Not due yet — keep in queue
          remaining.push(entry);
          continue;
        }

        // Attempt retry
        changed = true;
        log.debug(`[RetryScheduler] Retrying ${entry.id} (deferred attempt ${entry.deferredAttempt + 1}/${MAX_DEFERRED_ATTEMPTS})`);
        let result: WebhookActionResult;
        try {
          result = await executeWebhookRequest(entry.action, { timeoutMs: 30_000 });
        } catch (err) {
          result = {
            type: 'webhook',
            url: entry.expandedUrl,
            statusCode: 0,
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          };
        }

        if (result.success) {
          // Success — write history entry and drop from queue
          log.debug(`[RetryScheduler] ${entry.id} succeeded on deferred attempt ${entry.deferredAttempt + 1}`);
          const historyEntry = createWebhookHistoryEntry({
            matcherId: entry.matcherId,
            ok: true,
            method: entry.action.method,
            url: entry.expandedUrl,
            statusCode: result.statusCode,
            durationMs: result.durationMs ?? 0,
            attempts: entry.deferredAttempt + 1,
          });
          try {
            await appendAutomationHistoryEntry(this.workspaceRootPath, historyEntry);
          } catch (e) {
            log.debug(`[RetryScheduler] Failed to write history: ${e}`);
          }
          // Don't add to remaining — drop from queue
        } else if (entry.deferredAttempt + 1 >= MAX_DEFERRED_ATTEMPTS) {
          // Final attempt failed — write permanent failure to history
          log.debug(`[RetryScheduler] ${entry.id} permanently failed after ${MAX_DEFERRED_ATTEMPTS} deferred attempts`);
          const historyEntry = createWebhookHistoryEntry({
            matcherId: entry.matcherId,
            ok: false,
            method: entry.action.method,
            url: entry.expandedUrl,
            statusCode: result.statusCode,
            durationMs: result.durationMs ?? 0,
            attempts: entry.deferredAttempt + 1,
            error: result.error ?? 'Unknown error',
          });
          try {
            await appendAutomationHistoryEntry(this.workspaceRootPath, historyEntry);
          } catch (e) {
            log.debug(`[RetryScheduler] Failed to write history: ${e}`);
          }
          // Don't add to remaining — drop from queue
        } else {
          // Still retryable — schedule next deferred attempt
          const nextDelay = DEFERRED_DELAYS_MS[entry.deferredAttempt + 1]!;
          remaining.push({
            ...entry,
            deferredAttempt: entry.deferredAttempt + 1,
            nextRetryAt: Date.now() + nextDelay,
            lastError: result.error,
          });
          log.debug(`[RetryScheduler] ${entry.id} failed — next retry in ${nextDelay / 60_000}m`);
        }
      }

      if (!changed) return;

      const content = remaining.map(entry => JSON.stringify(entry) + '\n').join('');
      await this.replaceQueue(queuePath, content);
      } catch (err) {
        log.debug(`[RetryScheduler] Tick error: ${err}`);
      }
    });
  }

  /** Stage a complete snapshot beside the queue before replacing it under the queue lock. */
  private async replaceQueue(queuePath: string, content: string): Promise<void> {
    const tempPath = resolveAutomationOwnedPath(this.workspaceRootPath, `${queuePath}.${randomUUID()}.tmp`);
    const tempFile = await open(tempPath, 'wx', 0o600);
    try {
      try {
        await tempFile.writeFile(content, 'utf-8');
      } finally {
        await tempFile.close();
      }
      await rename(tempPath, resolveAutomationOwnedPath(this.workspaceRootPath, queuePath));
    } catch (error) {
      await unlink(tempPath).catch(cleanupError => {
        log.debug(`[RetryScheduler] Failed to remove temporary queue file: ${cleanupError}`);
      });
      throw error;
    }
  }

}
