/**
 * Tests for history-store: append + compaction with two-tier retention.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import * as childProcess from 'node:child_process';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, mkdtempSync, readdirSync, rmSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs';
import * as fsPromises from 'fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendAutomationHistoryEntry, compactAutomationHistory, compactAutomationHistorySync } from './history-store.ts';
import { AUTOMATIONS_HISTORY_FILE, AUTOMATION_HISTORY_MAX_ENTRIES } from './constants.ts';

function readHistory(dir: string): Array<{ id: string; ts: number; [k: string]: unknown }> {
  const path = join(dir, AUTOMATIONS_HISTORY_FILE);
  try {
    return readFileSync(path, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

function makeEntry(id: string, ts: number) {
  return { id, ts, ok: true };
}

function threeEntries(firstTs = 0): string {
  return Array.from({ length: 3 }, (_, i) => JSON.stringify(makeEntry('a1', firstTs + i))).join('\n') + '\n';
}

/** Compaction writes temp files through a descriptor or FileHandle, never by path. */
function isTempTarget(target: unknown): boolean {
  return typeof target === 'number' || (typeof target === 'object' && target !== null && 'fd' in target);
}

/** Runs `inspect` on each unpublished temp file right after compaction writes its content. */
function inspectTempWrites(dir: string, inspect: (tmpPath: string) => void): () => void {
  const inspectAll = () => {
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.tmp')) inspect(join(dir, name));
    }
  };
  const writeFileSyncOriginal = fs.writeFileSync;
  const syncSpy = spyOn(fs, 'writeFileSync').mockImplementation(((target, data, options) => {
    writeFileSyncOriginal(target, data, options as never);
    if (isTempTarget(target)) inspectAll();
  }) as never);
  const writeFileAsync = fsPromises.writeFile.bind(fsPromises);
  const asyncSpy = spyOn(fsPromises, 'writeFile').mockImplementation((async (target, data, options) => {
    await writeFileAsync(target, data, options);
    if (isTempTarget(target)) inspectAll();
  }) as never);
  return () => {
    syncSpy.mockRestore();
    asyncSpy.mockRestore();
  };
}

/** Drives the runtime path: the global-cap append that triggers compaction. */
async function appendThroughRuntimeCompaction(dir: string): Promise<void> {
  for (let i = 0; i < AUTOMATION_HISTORY_MAX_ENTRIES; i++) {
    await appendAutomationHistoryEntry(dir, makeEntry('a1', 1000 + i));
  }
}

const canSetPosixAcl = process.platform === 'linux' && spawnSync('setfacl', ['--version']).status === 0;

/** A label no policy defines: writable as a raw xattr only where no SELinux policy checks it. */
const SECRET_LABEL = 'system_u:object_r:storyflow_secret_t:s0';

function canWriteSecurityLabel(): boolean {
  if (process.platform !== 'linux') return false;
  const dir = mkdtempSync(join(tmpdir(), 'history-store-label-'));
  try {
    const file = join(dir, 'probe');
    writeFileSync(file, '');
    return spawnSync('setfattr', ['-n', 'security.selinux', '-v', SECRET_LABEL, file]).status === 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const canSetSecurityLabel = canWriteSecurityLabel();

/** Answers the Linux access probe with an `ls -ldnZ` line per probed path. */
function fakeLinuxListing(listingFor: (path: string) => string): () => void {
  const stdout = (args: readonly string[]) => listingFor(String(args[args.length - 1]));
  const syncSpy = spyOn(childProcess, 'execFileSync').mockImplementation(((_file: string, args: string[]) => stdout(args)) as never);
  const asyncSpy = spyOn(childProcess, 'execFile').mockImplementation(((_file: string, args: string[], ...rest: unknown[]) => {
    const callback = rest[rest.length - 1] as (error: Error | null, stdout: string, stderr: string) => void;
    queueMicrotask(() => callback(null, stdout(args), ''));
    return {} as never;
  }) as never);
  return () => {
    syncSpy.mockRestore();
    asyncSpy.mockRestore();
  };
}

describe('history-store', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'history-store-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ============================================================================
  // appendAutomationHistoryEntry
  // ============================================================================

  describe('appendAutomationHistoryEntry', () => {
    it('should create file and append entry', async () => {
      await appendAutomationHistoryEntry(tempDir, makeEntry('a1', 1000));
      const entries = readHistory(tempDir);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.id).toBe('a1');
    });

    it('should append multiple entries in order', async () => {
      for (let i = 0; i < 5; i++) {
        await appendAutomationHistoryEntry(tempDir, makeEntry('a1', i));
      }
      const entries = readHistory(tempDir);
      expect(entries).toHaveLength(5);
      expect(entries.map(e => e.ts)).toEqual([0, 1, 2, 3, 4]);
    });

    it('does not append history through a Project-internal file symlink', async () => {
      const outsideDir = mkdtempSync(join(tmpdir(), 'history-store-outside-'));
      const outsideHistory = join(outsideDir, AUTOMATIONS_HISTORY_FILE);
      writeFileSync(outsideHistory, 'sentinel\n');
      symlinkSync(outsideHistory, join(tempDir, AUTOMATIONS_HISTORY_FILE));

      try {
        await expect(appendAutomationHistoryEntry(tempDir, makeEntry('a1', 1))).rejects.toThrow(/symbolic link/);
        expect(readFileSync(outsideHistory, 'utf-8')).toBe('sentinel\n');
      } finally {
        rmSync(outsideDir, { recursive: true, force: true });
      }
    });
  });

  // ============================================================================
  // compactAutomationHistory
  // ============================================================================

  describe('compactAutomationHistory', () => {
    it('should keep only last N entries per automation ID', async () => {
      const lines = Array.from({ length: 30 }, (_, i) =>
        JSON.stringify(makeEntry('a1', i))
      ).join('\n') + '\n';
      writeFileSync(join(tempDir, AUTOMATIONS_HISTORY_FILE), lines);

      await compactAutomationHistory(tempDir, 20, 1000);

      const entries = readHistory(tempDir);
      expect(entries).toHaveLength(20);
      // Should keep the newest 20 (ts 10..29)
      expect(entries[0]!.ts).toBe(10);
      expect(entries[19]!.ts).toBe(29);
    });

    it('should keep N-per-ID independently across multiple IDs', async () => {
      const lines: string[] = [];
      // 25 entries for a1, 25 entries for a2 — interleaved
      for (let i = 0; i < 25; i++) {
        lines.push(JSON.stringify(makeEntry('a1', i)));
        lines.push(JSON.stringify(makeEntry('a2', 100 + i)));
      }
      writeFileSync(join(tempDir, AUTOMATIONS_HISTORY_FILE), lines.join('\n') + '\n');

      await compactAutomationHistory(tempDir, 20, 1000);

      const entries = readHistory(tempDir);
      const a1 = entries.filter(e => e.id === 'a1');
      const a2 = entries.filter(e => e.id === 'a2');
      expect(a1).toHaveLength(20);
      expect(a2).toHaveLength(20);
      // Oldest a1 entries (ts 0..4) should be dropped
      expect(a1[0]!.ts).toBe(5);
      // Oldest a2 entries (ts 100..104) should be dropped
      expect(a2[0]!.ts).toBe(105);
    });

    it('should enforce global cap after per-ID trimming', async () => {
      // 100 automations × 20 entries each = 2000 entries → should be capped to 1000
      const lines: string[] = [];
      for (let automationIdx = 0; automationIdx < 100; automationIdx++) {
        for (let i = 0; i < 20; i++) {
          lines.push(JSON.stringify(makeEntry(`auto-${automationIdx}`, automationIdx * 1000 + i)));
        }
      }
      writeFileSync(join(tempDir, AUTOMATIONS_HISTORY_FILE), lines.join('\n') + '\n');

      await compactAutomationHistory(tempDir, 20, 1000);

      const entries = readHistory(tempDir);
      expect(entries).toHaveLength(1000);
      // Should keep the last 1000 entries (from the later automations)
    });

    it('should preserve chronological order', async () => {
      const lines: string[] = [];
      for (let i = 0; i < 30; i++) {
        lines.push(JSON.stringify(makeEntry('a1', i * 10)));
      }
      writeFileSync(join(tempDir, AUTOMATIONS_HISTORY_FILE), lines.join('\n') + '\n');

      await compactAutomationHistory(tempDir, 20, 1000);

      const entries = readHistory(tempDir);
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i]!.ts).toBeGreaterThan(entries[i - 1]!.ts);
      }
    });

    it('should drop malformed JSON lines', async () => {
      const lines = [
        JSON.stringify(makeEntry('a1', 1)),
        'not-json{{{',
        JSON.stringify(makeEntry('a1', 2)),
        '',
        JSON.stringify(makeEntry('a1', 3)),
      ];
      writeFileSync(join(tempDir, AUTOMATIONS_HISTORY_FILE), lines.join('\n') + '\n');

      await compactAutomationHistory(tempDir, 20, 1000);

      const entries = readHistory(tempDir);
      expect(entries).toHaveLength(3);
    });

    it('should no-op when file does not exist', async () => {
      // Should not throw
      await compactAutomationHistory(tempDir, 20, 1000);
    });

    it('keeps the original history bytes when a compaction write stops after 10 bytes with ENOSPC', async () => {
      const historyPath = join(tempDir, AUTOMATIONS_HISTORY_FILE);
      const original = [
        JSON.stringify(makeEntry('a1', 1)),
        JSON.stringify(makeEntry('a1', 2)),
      ].join('\n') + '\n';
      writeFileSync(historyPath, original);
      const originalBytes = readFileSync(historyPath);

      const enospc = Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
      const writeFileSyncOriginal = fs.writeFileSync;
      let syncWrites = 0;
      const syncSpy = spyOn(fs, 'writeFileSync').mockImplementation(((target, data, options) => {
        if (isTempTarget(target)) {
          syncWrites += 1;
          const text = typeof data === 'string' ? data : Buffer.from(data as Uint8Array).toString('utf-8');
          writeFileSyncOriginal(target, text.slice(0, 10), options as never);
          throw enospc;
        }
        return writeFileSyncOriginal(target, data, options as never);
      }) as never);
      const writeFileAsync = fsPromises.writeFile.bind(fsPromises);
      let asyncWrites = 0;
      const asyncSpy = spyOn(fsPromises, 'writeFile').mockImplementation((async (target, data, options) => {
        if (isTempTarget(target)) {
          asyncWrites += 1;
          const text = typeof data === 'string' ? data : Buffer.from(data as Uint8Array).toString('utf-8');
          await writeFileAsync(target, text.slice(0, 10), options);
          throw enospc;
        }
        return writeFileAsync(target, data, options);
      }) as never);

      try {
        expect(() => compactAutomationHistorySync(tempDir, 1, 1000)).toThrow(/ENOSPC/);
        expect(syncWrites).toBe(1);
        expect(asyncWrites).toBe(0);
        expect(readFileSync(historyPath).equals(originalBytes)).toBe(true);

        const syncWritesAfterStartup = syncWrites;
        await expect(compactAutomationHistory(tempDir, 1, 1000)).rejects.toThrow(/ENOSPC/);
        expect(asyncWrites).toBe(1);
        expect(syncWrites).toBe(syncWritesAfterStartup);
        expect(readFileSync(historyPath).equals(originalBytes)).toBe(true);
        expect(readdirSync(tempDir)).toEqual([AUTOMATIONS_HISTORY_FILE]);
      } finally {
        syncSpy.mockRestore();
        asyncSpy.mockRestore();
      }
    });

    it.skipIf(process.platform === 'win32')('keeps the existing history file mode after startup and runtime compaction', async () => {
      const historyPath = join(tempDir, AUTOMATIONS_HISTORY_FILE);
      const lines = Array.from({ length: 3 }, (_, i) => JSON.stringify(makeEntry('a1', i))).join('\n') + '\n';
      writeFileSync(historyPath, lines);
      chmodSync(historyPath, 0o600);

      await compactAutomationHistory(tempDir, 1, 1000);

      expect(statSync(historyPath).mode & 0o777).toBe(0o600);
      expect(readHistory(tempDir)).toHaveLength(1);

      // 0666 is wider than a typical umask, so this fails if the replacement keeps the masked temp mode.
      chmodSync(historyPath, 0o666);
      appendFileSync(historyPath, `${JSON.stringify(makeEntry('a1', 10))}\n${JSON.stringify(makeEntry('a1', 11))}\n`);
      compactAutomationHistorySync(tempDir, 1, 1000);

      expect(statSync(historyPath).mode & 0o777).toBe(0o666);
      expect(readHistory(tempDir)).toHaveLength(1);
    });

    it.skipIf(process.platform === 'win32')('writes compacted history only into an owner-only temp file, then publishes the original mode', async () => {
      const historyPath = join(tempDir, AUTOMATIONS_HISTORY_FILE);
      writeFileSync(historyPath, threeEntries());
      chmodSync(historyPath, 0o644);
      const previousUmask = process.umask(0o022);
      const seen: Array<{ mode: number; size: number }> = [];
      const restore = inspectTempWrites(tempDir, tmpPath => {
        const stats = statSync(tmpPath);
        seen.push({ mode: stats.mode & 0o777, size: stats.size });
      });

      try {
        compactAutomationHistorySync(tempDir, 1, 1000);
        expect(statSync(historyPath).mode & 0o777).toBe(0o644);
        expect(readHistory(tempDir)).toHaveLength(1);

        appendFileSync(historyPath, threeEntries(10));
        await compactAutomationHistory(tempDir, 1, 1000);
        expect(statSync(historyPath).mode & 0o777).toBe(0o644);
        expect(readHistory(tempDir)).toHaveLength(1);
      } finally {
        restore();
        process.umask(previousUmask);
      }

      expect(seen).toHaveLength(2);
      for (const temp of seen) {
        expect(temp.size).toBeGreaterThan(0);
        expect(temp.mode).toBe(0o600);
      }
      expect(readdirSync(tempDir)).toEqual([AUTOMATIONS_HISTORY_FILE]);
    });

    it('skips compaction when the history mode cannot be read', async () => {
      const historyPath = join(tempDir, AUTOMATIONS_HISTORY_FILE);
      writeFileSync(historyPath, threeEntries());
      chmodSync(historyPath, 0o600);
      const originalBytes = readFileSync(historyPath);
      // Windows reports 0o666 here; compare against what the platform kept.
      const originalMode = statSync(historyPath).mode & 0o777;
      const previousUmask = process.umask(0o022);
      const eio = () => Object.assign(new Error('EIO: input/output error'), { code: 'EIO' });
      const stat = fs.statSync;
      const syncSpy = spyOn(fs, 'statSync').mockImplementation(((path, options) => {
        if (String(path) === historyPath) throw eio();
        return stat(path, options as never);
      }) as never);
      const statAsync = fsPromises.stat.bind(fsPromises);
      const asyncSpy = spyOn(fsPromises, 'stat').mockImplementation((async (path, options) => {
        if (String(path) === historyPath) throw eio();
        return statAsync(path, options as never);
      }) as never);

      try {
        expect(() => compactAutomationHistorySync(tempDir, 1, 1000)).not.toThrow();
        expect(readFileSync(historyPath).equals(originalBytes)).toBe(true);
        expect(stat(historyPath).mode & 0o777).toBe(originalMode);

        await compactAutomationHistory(tempDir, 1, 1000);
        expect(readFileSync(historyPath).equals(originalBytes)).toBe(true);
        expect(stat(historyPath).mode & 0o777).toBe(originalMode);
        expect(readdirSync(tempDir)).toEqual([AUTOMATIONS_HISTORY_FILE]);
      } finally {
        syncSpy.mockRestore();
        asyncSpy.mockRestore();
        process.umask(previousUmask);
      }
    });

    it('skips compaction when the access controls cannot be probed', async () => {
      const historyPath = join(tempDir, AUTOMATIONS_HISTORY_FILE);
      writeFileSync(historyPath, threeEntries());
      const originalBytes = readFileSync(historyPath);
      const spawnFailure = () => Object.assign(new Error('spawn ls ENOENT'), { code: 'ENOENT' });
      const syncSpy = spyOn(childProcess, 'execFileSync').mockImplementation((() => {
        throw spawnFailure();
      }) as never);
      const asyncSpy = spyOn(childProcess, 'execFile').mockImplementation(((...args: unknown[]) => {
        const callback = args[args.length - 1] as (error: Error, stdout: string, stderr: string) => void;
        queueMicrotask(() => callback(spawnFailure(), '', ''));
        return {} as never;
      }) as never);
      let tempWrites = 0;
      const restore = inspectTempWrites(tempDir, () => { tempWrites += 1; });

      try {
        expect(() => compactAutomationHistorySync(tempDir, 1, 1000)).not.toThrow();
        await compactAutomationHistory(tempDir, 1, 1000);
      } finally {
        restore();
        syncSpy.mockRestore();
        asyncSpy.mockRestore();
      }

      expect(tempWrites).toBe(0);
      expect(readFileSync(historyPath).equals(originalBytes)).toBe(true);
      expect(readdirSync(tempDir)).toEqual([AUTOMATIONS_HISTORY_FILE]);
    });

    it('does not publish a compaction when restoring the mode fails', async () => {
      const historyPath = join(tempDir, AUTOMATIONS_HISTORY_FILE);
      writeFileSync(historyPath, threeEntries());
      chmodSync(historyPath, 0o666);
      const originalBytes = readFileSync(historyPath);
      const previousUmask = process.umask(0o022);
      const eio = () => Object.assign(new Error('EIO'), { code: 'EIO' });
      const syncSpy = spyOn(fs, 'fchmodSync').mockImplementation((() => { throw eio(); }) as never);
      const openAsync = fsPromises.open.bind(fsPromises);
      const asyncSpy = spyOn(fsPromises, 'open').mockImplementation((async (...args: Parameters<typeof fsPromises.open>) => {
        const handle = await openAsync(...args);
        handle.chmod = async () => { throw eio(); };
        return handle;
      }) as never);

      try {
        expect(() => compactAutomationHistorySync(tempDir, 1, 1000)).not.toThrow();
        expect(readFileSync(historyPath).equals(originalBytes)).toBe(true);
        expect(statSync(historyPath).mode & 0o777).toBe(0o666);
        expect(readdirSync(tempDir)).toEqual([AUTOMATIONS_HISTORY_FILE]);

        await compactAutomationHistory(tempDir, 1, 1000);
        expect(readFileSync(historyPath).equals(originalBytes)).toBe(true);
        expect(statSync(historyPath).mode & 0o777).toBe(0o666);
        expect(readdirSync(tempDir)).toEqual([AUTOMATIONS_HISTORY_FILE]);
      } finally {
        syncSpy.mockRestore();
        asyncSpy.mockRestore();
        process.umask(previousUmask);
      }
    });

    it.skipIf(process.platform === 'win32')('keeps the original group on the replaced history file', async () => {
      const historyPath = join(tempDir, AUTOMATIONS_HISTORY_FILE);
      writeFileSync(historyPath, threeEntries());
      const defaultGid = statSync(historyPath).gid;
      const otherGid = process.getgroups?.().find(gid => gid !== defaultGid);
      if (otherGid === undefined) return;
      fs.chownSync(historyPath, process.getuid!(), otherGid);

      compactAutomationHistorySync(tempDir, 1, 1000);
      expect(readHistory(tempDir)).toHaveLength(1);
      expect(statSync(historyPath).gid).toBe(otherGid);

      appendFileSync(historyPath, threeEntries(10));
      await compactAutomationHistory(tempDir, 1, 1000);
      expect(readHistory(tempDir)).toHaveLength(1);
      expect(statSync(historyPath).gid).toBe(otherGid);
    });

    it.skipIf(process.platform !== 'darwin')('skips compaction while the history file has a macOS ACL new files would not get', async () => {
      const historyPath = join(tempDir, AUTOMATIONS_HISTORY_FILE);
      writeFileSync(historyPath, threeEntries());
      chmodSync(historyPath, 0o644);
      execFileSync('chmod', ['+a', 'nobody deny read', historyPath]);
      const originalBytes = readFileSync(historyPath);
      let tempWrites = 0;
      const restore = inspectTempWrites(tempDir, () => { tempWrites += 1; });

      try {
        compactAutomationHistorySync(tempDir, 1, 1000);
        await compactAutomationHistory(tempDir, 1, 1000);
        appendFileSync(historyPath, threeEntries(10));
        await appendThroughRuntimeCompaction(tempDir);
      } finally {
        restore();
      }

      expect(tempWrites).toBe(0);
      expect(readFileSync(historyPath).subarray(0, originalBytes.length).equals(originalBytes)).toBe(true);
      expect(statSync(historyPath).mode & 0o777).toBe(0o644);
      expect(execFileSync('ls', ['-le', historyPath], { encoding: 'utf8' })).toContain('user:nobody deny read');
      expect(readdirSync(tempDir)).toEqual([AUTOMATIONS_HISTORY_FILE]);
    });

    it.skipIf(process.platform !== 'darwin')('compacts under an inherited macOS ACL that protects the temp file before it has content', async () => {
      execFileSync('chmod', ['+a', 'nobody deny read,file_inherit', tempDir]);
      const historyPath = join(tempDir, AUTOMATIONS_HISTORY_FILE);
      writeFileSync(historyPath, threeEntries());
      chmodSync(historyPath, 0o644);
      const inheritedAce = 'user:nobody inherited deny read';
      expect(execFileSync('ls', ['-le', historyPath], { encoding: 'utf8' })).toContain(inheritedAce);
      const previousUmask = process.umask(0o022);
      const seen: Array<{ mode: number; size: number; acl: string }> = [];
      const restore = inspectTempWrites(tempDir, tmpPath => {
        const stats = statSync(tmpPath);
        seen.push({
          mode: stats.mode & 0o777,
          size: stats.size,
          acl: execFileSync('ls', ['-le', tmpPath], { encoding: 'utf8' }),
        });
      });

      try {
        compactAutomationHistorySync(tempDir, 1, 1000);
        expect(readHistory(tempDir)).toHaveLength(1);
        appendFileSync(historyPath, threeEntries(10));
        await compactAutomationHistory(tempDir, 1, 1000);
        expect(readHistory(tempDir)).toHaveLength(1);
      } finally {
        restore();
        process.umask(previousUmask);
      }

      expect(seen).toHaveLength(2);
      for (const temp of seen) {
        expect(temp.size).toBeGreaterThan(0);
        expect(temp.mode).toBe(0o600);
        expect(temp.acl).toContain(inheritedAce);
      }
      expect(statSync(historyPath).mode & 0o777).toBe(0o644);
      expect(execFileSync('ls', ['-le', historyPath], { encoding: 'utf8' })).toContain(inheritedAce);
    });

    it.skipIf(!canSetPosixAcl)('skips compaction while the history file has a Linux POSIX ACL', async () => {
      const historyPath = join(tempDir, AUTOMATIONS_HISTORY_FILE);
      writeFileSync(historyPath, threeEntries());
      chmodSync(historyPath, 0o644);
      execFileSync('setfacl', ['-m', 'u:nobody:---', historyPath]);
      const originalBytes = readFileSync(historyPath);
      let tempWrites = 0;
      const restore = inspectTempWrites(tempDir, () => { tempWrites += 1; });

      try {
        compactAutomationHistorySync(tempDir, 1, 1000);
        await compactAutomationHistory(tempDir, 1, 1000);
        appendFileSync(historyPath, threeEntries(10));
        await appendThroughRuntimeCompaction(tempDir);
      } finally {
        restore();
      }

      expect(tempWrites).toBe(0);
      expect(readFileSync(historyPath).subarray(0, originalBytes.length).equals(originalBytes)).toBe(true);
      expect(statSync(historyPath).mode & 0o777).toBe(0o644);
      expect(execFileSync('getfacl', ['-p', historyPath], { encoding: 'utf8' })).toContain('user:nobody:---');
      expect(readdirSync(tempDir)).toEqual([AUTOMATIONS_HISTORY_FILE]);
    });

    it.skipIf(!canSetSecurityLabel)('skips compaction while the history file has a security label new files would not get', async () => {
      const historyPath = join(tempDir, AUTOMATIONS_HISTORY_FILE);
      writeFileSync(historyPath, threeEntries());
      chmodSync(historyPath, 0o644);
      execFileSync('setfattr', ['-n', 'security.selinux', '-v', SECRET_LABEL, historyPath]);
      const originalBytes = readFileSync(historyPath);
      let tempWrites = 0;
      const restore = inspectTempWrites(tempDir, () => { tempWrites += 1; });

      try {
        compactAutomationHistorySync(tempDir, 1, 1000);
        await compactAutomationHistory(tempDir, 1, 1000);
        appendFileSync(historyPath, threeEntries(10));
        await appendThroughRuntimeCompaction(tempDir);
      } finally {
        restore();
      }

      expect(tempWrites).toBe(0);
      expect(readFileSync(historyPath).subarray(0, originalBytes.length).equals(originalBytes)).toBe(true);
      expect(execFileSync('getfattr', ['-n', 'security.selinux', '--only-values', historyPath], { encoding: 'utf8' }))
        .toContain(SECRET_LABEL);
      expect(readdirSync(tempDir)).toEqual([AUTOMATIONS_HISTORY_FILE]);
    });

    it.skipIf(process.platform !== 'linux')('compacts only when the temp file has the history file\'s confirmed security label', async () => {
      const historyPath = join(tempDir, AUTOMATIONS_HISTORY_FILE);
      const homeLabel = 'unconfined_u:object_r:user_home_t:s0';
      const listing = (marker: string, label: string) => `-rw-r--r--${marker} 1 1000 1000 ${label} 78 Nov 28 10:00 /w/h\n`;
      const cases = [
        { name: 'different label', history: listing('.', SECRET_LABEL), temp: listing('.', homeLabel), compacts: false },
        { name: 'label ls cannot show', history: listing('.', '?'), temp: listing('.', '?'), compacts: false },
        { name: 'same label', history: listing('.', homeLabel), temp: listing('.', homeLabel), compacts: true },
      ];

      for (const { name, history, temp, compacts } of cases) {
        writeFileSync(historyPath, threeEntries());
        const originalBytes = readFileSync(historyPath);
        let tempWrites = 0;
        const restoreWrites = inspectTempWrites(tempDir, () => { tempWrites += 1; });
        const restoreProbe = fakeLinuxListing(path => (path.endsWith('.tmp') ? temp : history));
        const lengths: number[] = [];
        let syncBytesKept = false;

        try {
          compactAutomationHistorySync(tempDir, 1, 1000);
          lengths.push(readHistory(tempDir).length);
          syncBytesKept = readFileSync(historyPath).equals(originalBytes);
          appendFileSync(historyPath, threeEntries(10));
          await compactAutomationHistory(tempDir, 1, 1000);
          lengths.push(readHistory(tempDir).length);
        } finally {
          restoreProbe();
          restoreWrites();
        }

        expect({ name, tempWrites, lengths }).toEqual({ name, tempWrites: compacts ? 2 : 0, lengths: compacts ? [1, 1] : [3, 6] });
        expect({ name, syncBytesKept }).toEqual({ name, syncBytesKept: !compacts });
        expect(readdirSync(tempDir)).toEqual([AUTOMATIONS_HISTORY_FILE]);
      }
    });

    it('should no-op when already within limits', async () => {
      const lines = Array.from({ length: 5 }, (_, i) =>
        JSON.stringify(makeEntry('a1', i))
      ).join('\n') + '\n';
      writeFileSync(join(tempDir, AUTOMATIONS_HISTORY_FILE), lines);

      await compactAutomationHistory(tempDir, 20, 1000);

      const entries = readHistory(tempDir);
      expect(entries).toHaveLength(5);
    });
  });

  // ============================================================================
  // Concurrent appends (mutex)
  // ============================================================================

  describe('concurrent appends', () => {
    it('should not lose entries under concurrent writes', async () => {
      const promises: Promise<void>[] = [];
      const count = 20;
      for (let i = 0; i < count; i++) {
        promises.push(appendAutomationHistoryEntry(tempDir, makeEntry('a1', i)));
      }
      await Promise.all(promises);

      const entries = readHistory(tempDir);
      expect(entries).toHaveLength(count);
    });
  });
});
