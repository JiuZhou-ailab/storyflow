// input: Session snapshots, controllable persistence I/O, and temporary workspace storage
// output: Regression coverage for serialized, recoverable, failure-aware session persistence
// pos: Public-seam tests for SessionPersistenceQueue and session storage recovery

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  utimesSync,
} from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionPersistenceQueue } from '../src/sessions/persistence-queue.ts';
import { listSessions, loadSession } from '../src/sessions/storage.ts';
import type { StoredSession } from '../src/sessions/types.ts';

// Create a minimal stored session for testing
function createTestSession(
  id: string,
  workspaceRootPath: string,
  sdkSessionId?: string
): StoredSession {
  return {
    id,
    workspaceRootPath,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    lastMessageAt: Date.now(),
    messages: [],
    sdkSessionId,
  };
}

function replaceSdkSessionId(jsonl: string, sdkSessionId: string): string {
  const lines = jsonl.trimEnd().split('\n');
  lines[0] = JSON.stringify({
    ...JSON.parse(lines[0]!),
    sdkSessionId,
  });
  return lines.join('\n') + '\n';
}

describe('SessionPersistenceQueue', () => {
  let testDir: string;
  let queue: SessionPersistenceQueue;

  beforeEach(() => {
    // Create a unique test directory
    testDir = join(tmpdir(), `persistence-queue-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    // Create sessions subdirectory structure
    mkdirSync(join(testDir, 'sessions', 'test-session'), { recursive: true });
    // Use 0ms debounce for immediate writes in tests
    queue = new SessionPersistenceQueue(0);
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('writes session to disk', async () => {
    const session = createTestSession('test-session', testDir, 'sdk-123');
    queue.enqueue(session);
    await queue.flush('test-session');

    const filePath = join(testDir, 'sessions', 'test-session', 'session.jsonl');
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, 'utf-8');
    const header = JSON.parse(content.split('\n')[0]);
    expect(header.sdkSessionId).toBe('sdk-123');
  });

  it('serializes concurrent flushes for the same session', async () => {
    // This test verifies the fix for the race condition where
    // clearSessionForRecovery() + onSdkSessionIdUpdate() would
    // both flush rapidly and corrupt each other's writes.

    // Simulate the problematic sequence:
    // 1. First write with sdkSessionId = undefined (clearing)
    const session1 = createTestSession('test-session', testDir, undefined);
    queue.enqueue(session1);
    const flush1 = queue.flush('test-session');

    // 2. Second write with new sdkSessionId (before first completes)
    const session2 = createTestSession('test-session', testDir, 'new-thread-id');
    queue.enqueue(session2);
    const flush2 = queue.flush('test-session');

    // Wait for both to complete
    await Promise.all([flush1, flush2]);

    // The final file should have the NEWER data (new-thread-id)
    const filePath = join(testDir, 'sessions', 'test-session', 'session.jsonl');
    const content = readFileSync(filePath, 'utf-8');
    const header = JSON.parse(content.split('\n')[0]);

    // Before the fix, this could randomly be undefined due to race condition
    expect(header.sdkSessionId).toBe('new-thread-id');
  });

  it('serializes a timer-triggered write with an overlapping flush', async () => {
    let releaseFirstWrite!: () => void;
    let firstWriteStarted!: () => void;
    const firstWriteGate = new Promise<void>(resolve => {
      releaseFirstWrite = resolve;
    });
    const firstWriteStart = new Promise<void>(resolve => {
      firstWriteStarted = resolve;
    });
    let writeCount = 0;

    queue = new SessionPersistenceQueue(0, async (path, data, encoding) => {
      writeCount++;
      if (writeCount === 1) {
        firstWriteStarted();
        await firstWriteGate;
      }
      await writeFile(path, data, encoding);
    });

    queue.enqueue(createTestSession('test-session', testDir, 'timer-write'));
    await firstWriteStart;

    queue.enqueue(createTestSession('test-session', testDir, 'flush-write'));
    const flush = queue.flush('test-session');
    await Bun.sleep(0);

    expect(writeCount).toBe(1);

    releaseFirstWrite();
    await flush;

    const filePath = join(testDir, 'sessions', 'test-session', 'session.jsonl');
    const header = JSON.parse(readFileSync(filePath, 'utf-8').split('\n')[0]);
    expect(header.sdkSessionId).toBe('flush-write');
  });

  it('does not recover a temporary file while its write is still active', async () => {
    queue.enqueue(createTestSession('test-session', testDir, 'committed'));
    await queue.flush('test-session');

    let releaseWrite!: () => void;
    let writeStarted!: () => void;
    const writeGate = new Promise<void>(resolve => {
      releaseWrite = resolve;
    });
    const started = new Promise<void>(resolve => {
      writeStarted = resolve;
    });
    queue = new SessionPersistenceQueue(0, async (path, data, encoding) => {
      await writeFile(path, data, encoding);
      writeStarted();
      await writeGate;
    });

    queue.enqueue(createTestSession('test-session', testDir, 'replacement'));
    const flush = queue.flush('test-session');
    await started;

    expect(loadSession(testDir, 'test-session')?.sdkSessionId).toBe('committed');
    expect(listSessions(testDir)[0]?.sdkSessionId).toBe('committed');

    releaseWrite();
    await flush;
    expect(loadSession(testDir, 'test-session')?.sdkSessionId).toBe('replacement');
  });

  it('allows parallel writes to different sessions', async () => {
    // Different sessions should write in parallel without blocking each other
    mkdirSync(join(testDir, 'sessions', 'session-a'), { recursive: true });
    mkdirSync(join(testDir, 'sessions', 'session-b'), { recursive: true });

    const sessionA = createTestSession('session-a', testDir, 'id-a');
    const sessionB = createTestSession('session-b', testDir, 'id-b');

    queue.enqueue(sessionA);
    queue.enqueue(sessionB);

    // Flush both in parallel
    await Promise.all([
      queue.flush('session-a'),
      queue.flush('session-b'),
    ]);

    // Both should be written correctly
    const contentA = readFileSync(
      join(testDir, 'sessions', 'session-a', 'session.jsonl'),
      'utf-8'
    );
    const contentB = readFileSync(
      join(testDir, 'sessions', 'session-b', 'session.jsonl'),
      'utf-8'
    );

    expect(JSON.parse(contentA.split('\n')[0]).sdkSessionId).toBe('id-a');
    expect(JSON.parse(contentB.split('\n')[0]).sdkSessionId).toBe('id-b');
  });

  it('preserves the last valid session when replacement fails', async () => {
    queue.enqueue(createTestSession('test-session', testDir, 'last-valid'));
    await queue.flush('test-session');

    const filePath = join(testDir, 'sessions', 'test-session', 'session.jsonl');
    mkdirSync(filePath + '.bak');

    queue.enqueue(createTestSession('test-session', testDir, 'replacement'));
    await expect(queue.flush('test-session')).rejects.toThrow();

    const header = JSON.parse(readFileSync(filePath, 'utf-8').split('\n')[0]);
    expect(header.sdkSessionId).toBe('last-valid');
  });

  it('recovers the newest valid JSONL candidate after a crash', async () => {
    queue.enqueue(createTestSession('test-session', testDir, 'committed'));
    await queue.flush('test-session');

    const filePath = join(testDir, 'sessions', 'test-session', 'session.jsonl');
    const committed = readFileSync(filePath, 'utf-8');
    writeFileSync(filePath + '.bak', replaceSdkSessionId(committed, 'backup'));
    writeFileSync(filePath + '.tmp', replaceSdkSessionId(committed, 'temporary'));

    const now = Date.now() / 1000;
    utimesSync(filePath, now - 3, now - 3);
    utimesSync(filePath + '.bak', now - 2, now - 2);
    utimesSync(filePath + '.tmp', now - 1, now - 1);

    listSessions(testDir);

    expect(loadSession(testDir, 'test-session')?.sdkSessionId).toBe('temporary');
    expect(existsSync(filePath + '.tmp')).toBe(false);
    expect(existsSync(filePath + '.bak')).toBe(false);
  });

  it('does not promote a newer corrupt crash candidate', async () => {
    queue.enqueue(createTestSession('test-session', testDir, 'committed'));
    await queue.flush('test-session');

    const filePath = join(testDir, 'sessions', 'test-session', 'session.jsonl');
    const committed = readFileSync(filePath, 'utf-8');
    writeFileSync(filePath + '.bak', replaceSdkSessionId(committed, 'backup'));
    writeFileSync(filePath + '.tmp', '{"id":"truncated"');

    const now = Date.now() / 1000;
    utimesSync(filePath, now - 3, now - 3);
    utimesSync(filePath + '.bak', now - 2, now - 2);
    utimesSync(filePath + '.tmp', now - 1, now - 1);

    listSessions(testDir);

    expect(loadSession(testDir, 'test-session')?.sdkSessionId).toBe('backup');
  });

  it('flush propagates a terminal timer write failure', async () => {
    let writeStarted!: () => void;
    const started = new Promise<void>(resolve => {
      writeStarted = resolve;
    });
    const failure = new Error('disk unavailable');
    queue = new SessionPersistenceQueue(0, async () => {
      writeStarted();
      throw failure;
    });

    queue.enqueue(createTestSession('test-session', testDir, 'unwritten'));
    await started;
    await Bun.sleep(0);

    await expect(queue.flush('test-session')).rejects.toBe(failure);
  });

  it('flushAll waits for timer writes and propagates terminal failures', async () => {
    let releaseWrite!: () => void;
    let writeStarted!: () => void;
    const writeGate = new Promise<void>(resolve => {
      releaseWrite = resolve;
    });
    const started = new Promise<void>(resolve => {
      writeStarted = resolve;
    });
    const failure = new Error('replacement failed');
    queue = new SessionPersistenceQueue(0, async () => {
      writeStarted();
      await writeGate;
      throw failure;
    });

    queue.enqueue(createTestSession('test-session', testDir, 'unwritten'));
    await started;

    let settled = false;
    const flushAll = queue.flushAll().finally(() => {
      settled = true;
    });
    await Bun.sleep(0);
    expect(settled).toBe(false);

    releaseWrite();
    await expect(flushAll).rejects.toBe(failure);
  });
});
