// input: Temporary JSONL fixtures with legacy and malformed persisted fields
// output: Regression coverage for session JSONL read-time normalization
// pos: Persistence-boundary contract test for session history

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeSessionPathPortable, readSessionHeader, readSessionJsonl, readSessionMessages, writeSessionJsonl } from '../jsonl.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

describe('session jsonl: permission mode normalization', () => {
  it('normalizes canonical permissionMode and previousPermissionMode in header reads', () => {
    const sessionDir = mkdtempSync(join(tmpdir(), 'session-mode-header-'));
    tempDirs.push(sessionDir);

    const sessionFile = join(sessionDir, 'session.jsonl');
    const header = {
      id: 's1',
      workspaceRootPath: '/tmp/ws',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      messageCount: 0,
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        contextTokens: 0,
        costUsd: 0,
      },
      permissionMode: 'execute',
      previousPermissionMode: 'explore',
    };

    writeFileSync(sessionFile, `${JSON.stringify(header)}\n`, 'utf-8');

    const loadedHeader = readSessionHeader(sessionFile);
    expect(loadedHeader?.permissionMode).toBe('allow-all');
    expect(loadedHeader?.previousPermissionMode).toBe('safe');
  });

  it('normalizes canonical mode values when loading full session', () => {
    const sessionDir = mkdtempSync(join(tmpdir(), 'session-mode-full-'));
    tempDirs.push(sessionDir);

    const sessionFile = join(sessionDir, 'session.jsonl');
    const header = {
      id: 's2',
      workspaceRootPath: '/tmp/ws',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      messageCount: 1,
      tokenUsage: {
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
        contextTokens: 0,
        costUsd: 0,
      },
      permissionMode: 'explore',
      previousPermissionMode: 'execute',
    };

    const message = {
      id: 'm1',
      type: 'user',
      content: 'hello',
      timestamp: Date.now(),
    };

    writeFileSync(sessionFile, `${JSON.stringify(header)}\n${JSON.stringify(message)}\n`, 'utf-8');

    const loaded = readSessionJsonl(sessionFile);
    expect(loaded?.permissionMode).toBe('safe');
    expect(loaded?.previousPermissionMode).toBe('allow-all');
  });

  it('reads legacy runtime ownership but drops it on the next write', () => {
    const sessionDir = mkdtempSync(join(tmpdir(), 'session-runtime-migration-'));
    tempDirs.push(sessionDir);

    const sessionFile = join(sessionDir, 'session.jsonl');
    writeFileSync(sessionFile, `${JSON.stringify({
      id: 'legacy-runtime',
      workspaceRootPath: '/tmp/ws',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      agentRuntime: 'claude-sdk',
      messageCount: 0,
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        contextTokens: 0,
        costUsd: 0,
      },
    })}\n`, 'utf-8');

    const loaded = readSessionJsonl(sessionFile);
    expect(loaded?.agentRuntime).toBe('claude-sdk');

    writeSessionJsonl(sessionFile, loaded!, sessionDir);
    const rewrittenHeader = JSON.parse(readFileSync(sessionFile, 'utf-8').split('\n')[0]!);
    expect(rewrittenHeader.agentRuntime).toBeUndefined();
  });

  it('loads full sessions while expanding portable paths and skipping corrupt message lines', () => {
    const sessionDir = mkdtempSync(join(tmpdir(), 'session-jsonl-contract-'));
    tempDirs.push(sessionDir);

    const sessionFile = join(sessionDir, 'session.jsonl');
    const tokenUsage = {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      contextTokens: 5,
      costUsd: 0.01,
    };
    const header = {
      id: 's3',
      workspaceRootPath: join(sessionDir, 'workspace'),
      workingDirectory: join(sessionDir, 'work'),
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      messageCount: 2,
      tokenUsage,
    };
    const message = {
      id: 'm1',
      type: 'tool',
      content: 'result',
      timestamp: Date.now(),
      artifactPath: join(sessionDir, 'artifact.json'),
    };

    writeFileSync(sessionFile, [
      makeSessionPathPortable(JSON.stringify(header), sessionDir),
      makeSessionPathPortable(JSON.stringify(message), sessionDir),
      '{"id":"broken"',
      '',
    ].join('\n'), 'utf-8');

    const loaded = readSessionJsonl(sessionFile);
    expect(loaded?.workspaceRootPath).toBe(join(sessionDir, 'workspace'));
    expect(loaded?.workingDirectory).toBe(join(sessionDir, 'work'));
    expect(loaded?.sdkCwd).toBe(join(sessionDir, 'work'));
    expect(loaded?.tokenUsage).toEqual(tokenUsage);
    expect(loaded?.messages).toHaveLength(1);
    expect(loaded?.messages[0]).toEqual(expect.objectContaining({
      id: 'm1',
      artifactPath: join(sessionDir, 'artifact.json'),
    }));
  });

  it('drops null attachment entries from persisted messages', () => {
    const sessionDir = mkdtempSync(join(tmpdir(), 'session-jsonl-attachments-'));
    tempDirs.push(sessionDir);

    const sessionFile = join(sessionDir, 'session.jsonl');
    writeFileSync(sessionFile, [
      JSON.stringify({ id: 's4' }),
      JSON.stringify({ id: 'm1', type: 'user', attachments: [null] }),
    ].join('\n'), 'utf-8');

    expect(readSessionMessages(sessionFile)[0]?.attachments).toEqual([]);
  });
});
