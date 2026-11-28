/**
 * Tests for history-store: append + compaction with two-tier retention.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, mkdtempSync, readdirSync, rmSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs';
import * as fsPromises from 'fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendAutomationHistoryEntry, compactAutomationHistory, compactAutomationHistorySync } from './history-store.ts';
import { AUTOMATIONS_HISTORY_FILE } from './constants.ts';

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
      const syncSpy = spyOn(fs, 'writeFileSync').mockImplementation(((path, data, options) => {
        if (String(path).includes(AUTOMATIONS_HISTORY_FILE)) {
          syncWrites += 1;
          const text = typeof data === 'string' ? data : Buffer.from(data as Uint8Array).toString('utf-8');
          writeFileSyncOriginal(path, text.slice(0, 10), options as never);
          throw enospc;
        }
        return writeFileSyncOriginal(path, data, options as never);
      }) as never);
      const writeFileAsync = fsPromises.writeFile.bind(fsPromises);
      let asyncWrites = 0;
      const asyncSpy = spyOn(fsPromises, 'writeFile').mockImplementation((async (path, data, options) => {
        if (String(path).includes(AUTOMATIONS_HISTORY_FILE)) {
          asyncWrites += 1;
          const text = typeof data === 'string' ? data : Buffer.from(data as Uint8Array).toString('utf-8');
          await writeFileAsync(path, text.slice(0, 10), options);
          throw enospc;
        }
        return writeFileAsync(path, data, options);
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

    it('skips compaction when the history mode cannot be read', async () => {
      const historyPath = join(tempDir, AUTOMATIONS_HISTORY_FILE);
      const original = [
        JSON.stringify(makeEntry('a1', 1)),
        JSON.stringify(makeEntry('a1', 2)),
      ].join('\n') + '\n';
      writeFileSync(historyPath, original);
      chmodSync(historyPath, 0o600);
      const originalBytes = readFileSync(historyPath);
      const previousUmask = process.umask(0o022);
      const stat = fs.statSync;
      const spy = spyOn(fs, 'statSync').mockImplementation(((path, options) => {
        if (String(path) === historyPath) {
          const error = new Error('EIO: input/output error') as NodeJS.ErrnoException;
          error.code = 'EIO';
          throw error;
        }
        return stat(path, options as never);
      }) as never);

      try {
        expect(() => compactAutomationHistorySync(tempDir, 1, 1000)).not.toThrow();
        expect(readFileSync(historyPath).equals(originalBytes)).toBe(true);
        expect(stat(historyPath).mode & 0o777).toBe(0o600);

        await compactAutomationHistory(tempDir, 1, 1000);
        expect(readFileSync(historyPath).equals(originalBytes)).toBe(true);
        expect(stat(historyPath).mode & 0o777).toBe(0o600);
      } finally {
        spy.mockRestore();
        process.umask(previousUmask);
      }
    });

    it('does not publish a compaction when restoring the mode fails', async () => {
      const historyPath = join(tempDir, AUTOMATIONS_HISTORY_FILE);
      const original = [
        JSON.stringify(makeEntry('a1', 1)),
        JSON.stringify(makeEntry('a1', 2)),
      ].join('\n') + '\n';
      writeFileSync(historyPath, original);
      chmodSync(historyPath, 0o666);
      const originalBytes = readFileSync(historyPath);
      const previousUmask = process.umask(0o022);
      const chmodSyncOriginal = fs.chmodSync;
      const syncSpy = spyOn(fs, 'chmodSync').mockImplementation(((path, mode) => {
        if (String(path).includes(`${AUTOMATIONS_HISTORY_FILE}.`)) throw Object.assign(new Error('EIO'), { code: 'EIO' });
        return chmodSyncOriginal(path, mode);
      }) as never);
      const chmodAsync = fsPromises.chmod.bind(fsPromises);
      const asyncSpy = spyOn(fsPromises, 'chmod').mockImplementation((async (path, mode) => {
        if (String(path).includes(`${AUTOMATIONS_HISTORY_FILE}.`)) throw Object.assign(new Error('EIO'), { code: 'EIO' });
        return chmodAsync(path, mode);
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

    it.skipIf(process.platform !== 'darwin')('keeps a macOS deny-read ACL on the replaced history file', async () => {
      const historyPath = join(tempDir, AUTOMATIONS_HISTORY_FILE);
      const lines = Array.from({ length: 3 }, (_, i) => JSON.stringify(makeEntry('a1', i))).join('\n') + '\n';
      writeFileSync(historyPath, lines);
      chmodSync(historyPath, 0o644);
      execFileSync('chmod', ['+a', 'nobody deny read', historyPath]);

      await compactAutomationHistory(tempDir, 1, 1000);

      expect(readHistory(tempDir)).toHaveLength(1);
      expect(statSync(historyPath).mode & 0o777).toBe(0o644);
      expect(execFileSync('ls', ['-le', historyPath], { encoding: 'utf8' })).toContain('user:nobody deny read');

      appendFileSync(historyPath, `${JSON.stringify(makeEntry('a1', 10))}\n${JSON.stringify(makeEntry('a1', 11))}\n`);
      compactAutomationHistorySync(tempDir, 1, 1000);

      expect(readHistory(tempDir)).toHaveLength(1);
      expect(statSync(historyPath).mode & 0o777).toBe(0o644);
      expect(execFileSync('ls', ['-le', historyPath], { encoding: 'utf8' })).toContain('user:nobody deny read');
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
