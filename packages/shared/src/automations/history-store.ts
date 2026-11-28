/**
 * History Store — single source of truth for automations-history.jsonl writes
 * and compaction.
 *
 * Provides:
 * - `appendAutomationHistoryEntry()` — serialized append, triggers compaction at the global cap
 * - `compactAutomationHistory()` — async two-tier retention (runtime, under mutex)
 * - `compactAutomationHistorySync()` — sync two-tier retention (startup, no mutex needed)
 *
 * Both sync and async compaction share the same pure algorithm (`compactEntries`).
 * All history writes should go through `appendAutomationHistoryEntry` so the mutex
 * prevents concurrent file corruption.
 */

import { randomUUID } from 'node:crypto';
import { appendFile, open, readFile, rename, stat, unlink, writeFile, type FileHandle } from 'fs/promises';
import {
  closeSync,
  existsSync,
  fchmodSync,
  fchownSync,
  fstatSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'path';
import { createLogger } from '../utils/debug.ts';
import { readAccessSignature, readAccessSignatureSync } from '../utils/file-access.ts';
import { retryTransientFs, retryTransientFsErrorSync } from '../utils/files.ts';
import {
  AUTOMATIONS_HISTORY_FILE,
  AUTOMATION_HISTORY_MAX_RUNS_PER_MATCHER,
  AUTOMATION_HISTORY_MAX_ENTRIES,
} from './constants.ts';
import { resolveAutomationOwnedPath } from './resolve-config-path.ts';

const log = createLogger('history-store');

// ============================================================================
// Per-workspace mutex — serializes writes to avoid corruption
// ============================================================================

const mutexes = new Map<string, Promise<void>>();

function withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = mutexes.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  mutexes.set(key, next.then(() => {}, () => {}));
  return next;
}

// ============================================================================
// Append
// ============================================================================

/**
 * Appends since startup per workspace. Startup compaction guarantees ≤ MAX_ENTRIES,
 * so this counter tells us when the file has grown enough to need compaction again.
 */
const appendCounters = new Map<string, number>();

/**
 * Append a history entry to the JSONL file.
 * Triggers compaction when appends since startup reach the global cap.
 *
 * The entry must already be a fully-formed history object (use `createWebhookHistoryEntry`
 * or `createPromptHistoryEntry` from `webhook-utils.ts` to build one).
 */
export async function appendAutomationHistoryEntry(
  workspaceRootPath: string,
  entry: Record<string, unknown>,
): Promise<void> {
  await withMutex(workspaceRootPath, async () => {
    const historyPath = resolveAutomationOwnedPath(
      workspaceRootPath,
      join(workspaceRootPath, AUTOMATIONS_HISTORY_FILE),
    );
    await appendFile(historyPath, JSON.stringify(entry) + '\n', 'utf-8');

    const count = (appendCounters.get(workspaceRootPath) ?? 0) + 1;
    appendCounters.set(workspaceRootPath, count);

    if (count >= AUTOMATION_HISTORY_MAX_ENTRIES) {
      appendCounters.set(workspaceRootPath, 0);
      await runCompaction(workspaceRootPath, historyPath);
    }
  });
}

// ============================================================================
// Compaction
// ============================================================================

/**
 * Compact the history file asynchronously (runtime path, under mutex).
 */
export async function compactAutomationHistory(
  workspaceRootPath: string,
  maxPerMatcher: number = AUTOMATION_HISTORY_MAX_RUNS_PER_MATCHER,
  maxTotal: number = AUTOMATION_HISTORY_MAX_ENTRIES,
): Promise<void> {
  await withMutex(workspaceRootPath, () => {
    const historyPath = resolveAutomationOwnedPath(
      workspaceRootPath,
      join(workspaceRootPath, AUTOMATIONS_HISTORY_FILE),
    );
    return runCompaction(workspaceRootPath, historyPath, maxPerMatcher, maxTotal);
  });
}

/**
 * Compact the history file synchronously (startup path).
 * Safe to call without the mutex — startup is single-threaded and runs
 * before any async appends.
 * Replacement goes through a sibling temp file; see `replaceHistoryFileSync`
 * for how the original's access controls are kept.
 */
export function compactAutomationHistorySync(
  workspaceRootPath: string,
  maxPerMatcher: number = AUTOMATION_HISTORY_MAX_RUNS_PER_MATCHER,
  maxTotal: number = AUTOMATION_HISTORY_MAX_ENTRIES,
): void {
  const historyPath = resolveAutomationOwnedPath(
    workspaceRootPath,
    join(workspaceRootPath, AUTOMATIONS_HISTORY_FILE),
  );
  if (!existsSync(historyPath)) return;

  let content: string;
  try { content = readFileSync(historyPath, 'utf-8'); } catch { return; }

  const result = compactEntries(content, maxPerMatcher, maxTotal);
  if (!result) return;

  if (replaceHistoryFileSync(resolveAutomationOwnedPath(workspaceRootPath, historyPath), result)) {
    log.debug(`[HistoryStore] Startup compaction complete`);
  }
}

/**
 * Internal async compaction — must be called inside withMutex.
 * Writes a sibling temp file and renames it without blocking the event loop.
 */
async function runCompaction(
  workspaceRootPath: string,
  historyPath: string,
  maxPerMatcher: number = AUTOMATION_HISTORY_MAX_RUNS_PER_MATCHER,
  maxTotal: number = AUTOMATION_HISTORY_MAX_ENTRIES,
): Promise<void> {
  let content: string;
  try {
    if (!existsSync(historyPath)) return;
    content = await readFile(historyPath, 'utf-8');
  } catch {
    return;
  }

  const result = compactEntries(content, maxPerMatcher, maxTotal);
  if (!result) return;

  if (await replaceHistoryFile(
    resolveAutomationOwnedPath(workspaceRootPath, historyPath),
    result,
  )) {
    log.debug(`[HistoryStore] Compacted history`);
  }
}

/**
 * Access a replacement must carry before it is published. Mode and owner are
 * copied with fs calls; extended access (macOS ACL, Linux ACL, Windows DACL)
 * is compared by signature because it cannot be copied without native code.
 */
interface HistoryAccess {
  mode: number;
  uid: number;
  gid: number;
  signature: string;
}

function readHistoryAccessSync(filePath: string): HistoryAccess | null {
  let stats;
  try { stats = statSync(filePath); } catch { return null; }
  const signature = readAccessSignatureSync(filePath);
  if (signature === null) return null;
  return { mode: stats.mode & 0o777, uid: stats.uid, gid: stats.gid, signature };
}

async function readHistoryAccess(filePath: string): Promise<HistoryAccess | null> {
  let stats;
  try { stats = await stat(filePath); } catch { return null; }
  const signature = await readAccessSignature(filePath);
  if (signature === null) return null;
  return { mode: stats.mode & 0o777, uid: stats.uid, gid: stats.gid, signature };
}

function tempPathFor(filePath: string): string {
  return `${filePath}.${process.pid}.${randomUUID()}.tmp`;
}

function skipCompaction(filePath: string, reason: string): false {
  log.warn(`[HistoryStore] Skipped compaction of ${filePath}: ${reason}`);
  return false;
}

const TEMP_OWNER_MISMATCH = 'the temp file owner could not match the original';
const TEMP_ACCESS_MISMATCH = 'the temp file access controls could not match the original';
const TEMP_MODE_MISMATCH = 'the temp file mode could not match the original';

/**
 * Write `data` into a new owner-only temp file. Content goes in only after the
 * temp file has the original's owner and extended access; the original mode is
 * applied last. Returns why the temp file cannot stand in for the original, or
 * null when it is ready to publish.
 */
function writeProtectedTempSync(tmpPath: string, data: string, access: HistoryAccess): string | null {
  const fd = openSync(tmpPath, 'wx', 0o600);
  try {
    const stats = fstatSync(fd);
    if (stats.uid !== access.uid || stats.gid !== access.gid) {
      try { fchownSync(fd, access.uid, access.gid); } catch { return TEMP_OWNER_MISMATCH; }
    }
    if (readAccessSignatureSync(tmpPath) !== access.signature) return TEMP_ACCESS_MISMATCH;
    writeFileSync(fd, data, 'utf-8');
    try { fchmodSync(fd, access.mode); } catch { return TEMP_MODE_MISMATCH; }
    return null;
  } finally {
    closeSync(fd);
  }
}

async function writeProtectedTemp(tmpPath: string, data: string, access: HistoryAccess): Promise<string | null> {
  const handle: FileHandle = await open(tmpPath, 'wx', 0o600);
  try {
    const stats = await handle.stat();
    if (stats.uid !== access.uid || stats.gid !== access.gid) {
      try { await handle.chown(access.uid, access.gid); } catch { return TEMP_OWNER_MISMATCH; }
    }
    if (await readAccessSignature(tmpPath) !== access.signature) return TEMP_ACCESS_MISMATCH;
    await writeFile(handle, data, 'utf-8');
    try { await handle.chmod(access.mode); } catch { return TEMP_MODE_MISMATCH; }
    return null;
  } finally {
    await handle.close();
  }
}

/**
 * Replace the history file without ever widening who can read it. The temp
 * file is owner-only from creation and gets content only once its owner and
 * extended access equal the original's. If the original's access cannot be
 * read, or the temp file cannot match it (for example an ACL that differs from
 * what the directory gives new files), the original stays untouched and this
 * compaction is skipped. Write and rename failures throw.
 */
function replaceHistoryFileSync(filePath: string, data: string): boolean {
  const access = readHistoryAccessSync(filePath);
  if (!access) return skipCompaction(filePath, 'its access controls could not be read');
  const tmpPath = tempPathFor(filePath);
  let published = false;
  try {
    const mismatch = writeProtectedTempSync(tmpPath, data, access);
    if (mismatch) return skipCompaction(filePath, mismatch);
    retryTransientFsErrorSync(() => renameSync(tmpPath, filePath));
    published = true;
    return true;
  } finally {
    if (!published) {
      try { unlinkSync(tmpPath); } catch {}
    }
  }
}

async function replaceHistoryFile(filePath: string, data: string): Promise<boolean> {
  const access = await readHistoryAccess(filePath);
  if (!access) return skipCompaction(filePath, 'its access controls could not be read');
  const tmpPath = tempPathFor(filePath);
  let published = false;
  try {
    const mismatch = await writeProtectedTemp(tmpPath, data, access);
    if (mismatch) return skipCompaction(filePath, mismatch);
    await retryTransientFs(() => rename(tmpPath, filePath));
    published = true;
    return true;
  } finally {
    if (!published) {
      try { await unlink(tmpPath); } catch {}
    }
  }
}

// ============================================================================
// Pure compaction algorithm — shared by sync and async paths
// ============================================================================

/**
 * Apply two-tier retention to JSONL content:
 * 1. Per-automation cap: keep last `maxPerMatcher` entries per automation ID
 * 2. Global cap: keep last `maxTotal` entries overall
 *
 * Also drops malformed JSON lines.
 *
 * Returns the compacted output string, or `null` if no compaction was needed.
 */
function compactEntries(
  content: string,
  maxPerMatcher: number,
  maxTotal: number,
): string | null {
  const lines = content.trim().split('\n').filter(Boolean);
  if (lines.length === 0) return null;

  // Parse all lines, dropping malformed ones
  const entries: Array<{ raw: string; id: string }> = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      entries.push({ raw: line, id: parsed.id ?? '' });
    } catch {
      // Drop malformed lines
    }
  }

  // Track original line count (including malformed) for dirty-check
  const originalLineCount = lines.length;

  // 1) Per-automation cap: keep only last N per ID
  const byId = new Map<string, number[]>();
  for (let i = 0; i < entries.length; i++) {
    const id = entries[i]!.id;
    let group = byId.get(id);
    if (!group) {
      group = [];
      byId.set(id, group);
    }
    group.push(i);
  }

  const keepIndices = new Set<number>();
  for (const indices of byId.values()) {
    const kept = indices.slice(-maxPerMatcher);
    for (const idx of kept) {
      keepIndices.add(idx);
    }
  }

  let trimmed = entries.filter((_, i) => keepIndices.has(i));

  // 2) Global cap: if still over limit, drop oldest globally
  if (trimmed.length > maxTotal) {
    trimmed = trimmed.slice(-maxTotal);
  }

  if (trimmed.length === originalLineCount) return null;

  return trimmed.map(e => e.raw).join('\n') + '\n';
}
