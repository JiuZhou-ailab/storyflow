// input: Project-owned automation retry/event files that may be pre-created as symlinks
// output: Regression coverage that automation writes never follow those symlinks
// pos: Guards the shared automation persistence boundary

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUTOMATIONS_RETRY_QUEUE_FILE } from './constants.ts';
import { AutomationEventLogger } from './event-logger.ts';
import { RetryScheduler } from './retry-scheduler.ts';

const roots: string[] = [];

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

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

  it('does not lose an enqueue while a retry tick rewrites the queue', async () => {
    const projectRoot = tempRoot('automation-retry-concurrency-');
    const queuePath = join(projectRoot, AUTOMATIONS_RETRY_QUEUE_FILE);
    writeFileSync(queuePath, `${JSON.stringify({
      id: 'old',
      matcherId: 'old-matcher',
      action: { type: 'webhook', url: 'https://example.test/old' },
      expandedUrl: 'https://example.test/old',
      deferredAttempt: 0,
      nextRetryAt: 0,
      createdAt: 0,
    })}\n`);

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
      const tick = (scheduler as unknown as { processQueue(): Promise<void> }).processQueue();
      await started;
      const enqueue = scheduler.enqueue(
        'new-matcher',
        { type: 'webhook', url: 'https://example.test/new' },
        'https://example.test/new',
      );
      releaseRequest();
      await Promise.all([tick, enqueue]);

      expect(readFileSync(queuePath, 'utf-8')).toContain('new-matcher');
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
