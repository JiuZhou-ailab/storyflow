// input: Project-owned automation files, filesystem failures, and concurrent queue operations
// output: Regression coverage for path ownership and retry queue integrity
// pos: Guards the shared automation persistence boundary

import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUTOMATIONS_RETRY_QUEUE_FILE } from './constants.ts';
import { AutomationEventLogger } from './event-logger.ts';
import { RetryScheduler, type RetryQueueEntry } from './retry-scheduler.ts';

const roots: string[] = [];

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function queueEntry(id: string, nextRetryAt: number): RetryQueueEntry {
  const url = `https://example.test/${id}`;
  return {
    id,
    matcherId: `${id}-matcher`,
    action: { type: 'webhook', url },
    expandedUrl: url,
    deferredAttempt: 0,
    nextRetryAt,
    createdAt: 0,
  };
}

function processRetryQueue(scheduler: RetryScheduler): Promise<void> {
  return (scheduler as unknown as { processQueue(): Promise<void> }).processQueue();
}

describe('automation storage boundary', () => {
  it('does not enqueue retries through a Project-internal file symlink', async () => {
    const projectRoot = tempRoot('automation-retry-project-');
    const outsideRoot = tempRoot('automation-retry-outside-');
    const outsideQueue = join(outsideRoot, AUTOMATIONS_RETRY_QUEUE_FILE);
    writeFileSync(outsideQueue, 'sentinel\n');
    symlinkSync(outsideQueue, join(projectRoot, AUTOMATIONS_RETRY_QUEUE_FILE));

    const scheduler = new RetryScheduler({ workspaceRootPath: projectRoot });
    await expect(scheduler.enqueue(
      'matcher-1',
      { type: 'webhook', url: 'https://example.test/hook' },
      'https://example.test/hook',
    )).rejects.toThrow(/symbolic link/);
    expect(readFileSync(outsideQueue, 'utf-8')).toBe('sentinel\n');
  });

  it('leaves the queue file untouched when no retries are due', async () => {
    const projectRoot = tempRoot('automation-retry-unchanged-');
    const queuePath = join(projectRoot, AUTOMATIONS_RETRY_QUEUE_FILE);
    const future = Date.now() + 60_000;
    const original = ` ${JSON.stringify(queueEntry('first', future))}\r\n${JSON.stringify(queueEntry('second', future))}\r\n`;
    writeFileSync(queuePath, original);

    await processRetryQueue(new RetryScheduler({ workspaceRootPath: projectRoot }));

    expect(readFileSync(queuePath, 'utf-8')).toBe(original);
  });

  it.each(['write', 'rename'] as const)('keeps the original retry queue when %s fails', async (operation) => {
    const projectRoot = tempRoot('automation-retry-failure-');
    const queuePath = join(projectRoot, AUTOMATIONS_RETRY_QUEUE_FILE);
    const future = Date.now() + 60_000;
    const entries = [queueEntry('due', 0), queueEntry('first', future), queueEntry('second', future)];
    const original = entries.map(entry => JSON.stringify(entry) + '\n').join('');
    writeFileSync(queuePath, original);

    const fetch = spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('', { status: 200 }));
    const openFile = fs.open;
    const failure = operation === 'write'
      ? spyOn(fs, 'open').mockImplementation(async (...args) => {
        const file = await openFile(...args);
        // Leave a partial file behind, as a write interrupted by ENOSPC can do.
        spyOn(file, 'writeFile').mockImplementation(async () => {
          await file.write('{');
          throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' });
        });
        return file;
      })
      : spyOn(fs, 'rename').mockRejectedValue(Object.assign(new Error('Rename failed'), { code: 'EIO' }));

    try {
      await processRetryQueue(new RetryScheduler({ workspaceRootPath: projectRoot }));

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(readFileSync(queuePath, 'utf-8')).toBe(original);
      expect(failure).toHaveBeenCalledTimes(1);
      expect(readdirSync(projectRoot).filter(name => name.endsWith('.tmp'))).toEqual([]);
    } finally {
      failure.mockRestore();
      fetch.mockRestore();
    }
  });

  it('does not lose an enqueue while a retry tick rewrites the queue', async () => {
    const projectRoot = tempRoot('automation-retry-concurrency-');
    const queuePath = join(projectRoot, AUTOMATIONS_RETRY_QUEUE_FILE);
    writeFileSync(queuePath, `${JSON.stringify(queueEntry('old', 0))}\n`);

    let markStarted!: () => void;
    let releaseRequest!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const requestBarrier = new Promise<void>(resolve => { releaseRequest = resolve; });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      markStarted();
      await requestBarrier;
      return new Response('', { status: 200 });
    };

    try {
      const scheduler = new RetryScheduler({ workspaceRootPath: projectRoot });
      const tick = processRetryQueue(scheduler);
      await started;
      const enqueue = scheduler.enqueue(
        'new-matcher',
        { type: 'webhook', url: 'https://example.test/new' },
        'https://example.test/new',
      );
      releaseRequest();
      await Promise.all([tick, enqueue]);

      const entries = readFileSync(queuePath, 'utf-8').trim().split('\n').map(line => JSON.parse(line));
      expect(entries.map(entry => entry.matcherId)).toEqual(['new-matcher']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not flush events through a Project-internal file symlink', async () => {
    const projectRoot = tempRoot('automation-events-project-');
    const outsideRoot = tempRoot('automation-events-outside-');
    const outsideEvents = join(outsideRoot, 'events.jsonl');
    writeFileSync(outsideEvents, 'sentinel\n');
    symlinkSync(outsideEvents, join(projectRoot, 'events.jsonl'));

    const logger = new AutomationEventLogger(projectRoot);
    logger.onEventLost = () => {};
    logger.log({ type: 'Test', data: {}, results: [], durationMs: 0 });
    await logger.close();

    expect(readFileSync(outsideEvents, 'utf-8')).toBe('sentinel\n');
  });
});
