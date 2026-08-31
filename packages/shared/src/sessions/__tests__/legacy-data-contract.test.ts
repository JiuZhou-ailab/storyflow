// input: Frozen legacy session JSONL snapshots (0.15 claude-sdk era through 0.18.x)
// output: Assertions that current readers keep every historical format accessible
// pos: ADR 0021 data-contract gate — the 0.18.0 "fingerprint without migration"
//      incident regression barrier for Storyflow-owned persisted data

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listSessions, listSessionsAsync } from '../storage.ts';
import { getLegacyWorkspaceSessionsPath, getWorkspaceSessionsPath } from '../../workspaces/paths.ts';

let workspaceRoot: string | undefined;

afterEach(() => {
  if (workspaceRoot) rmSync(workspaceRoot, { recursive: true, force: true });
  workspaceRoot = undefined;
});

/**
 * Frozen v0.15-era snapshot: pre-Pi claude-sdk session stored in the legacy
 * `{root}/sessions/` directory with an absolute workspaceRootPath from the
 * machine it was created on. Do not "modernize" this literal — its point is
 * to stay exactly what old installs have on disk.
 */
function seedLegacyClaudeSdkSession(root: string): string {
  const sessionId = 'ses-legacy-0150';
  const sessionDir = join(getLegacyWorkspaceSessionsPath(root), sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const header = JSON.stringify({
    id: sessionId,
    agentRuntime: 'claude-sdk',
    workspaceRootPath: '/Users/olduser/projects/moved-elsewhere',
    name: 'legacy claude-sdk session',
    createdAt: 1720000000000,
    lastUsedAt: 1720000100000,
    todoState: 'todo',
    workingDirectory: '/Users/olduser/projects/moved-elsewhere/docs',
  });
  const message = JSON.stringify({
    id: 'msg-1',
    role: 'user',
    content: 'hello from 0.15',
    timestamp: 1720000050000,
  });
  writeFileSync(join(sessionDir, 'session.jsonl'), `${header}\n${message}\n`);
  return sessionId;
}

/** Frozen 0.17/0.18-era snapshot: modern path, Pi runtime, no schemaVersion. */
function seedPreVersionedPiSession(root: string): string {
  const sessionId = 'ses-legacy-0180';
  const sessionDir = join(getWorkspaceSessionsPath(root), sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const header = JSON.stringify({
    id: sessionId,
    workspaceRootPath: root,
    name: 'pre-versioned pi session',
    createdAt: 1750000000000,
    lastUsedAt: 1750000100000,
    sessionStatus: 'todo',
    permissionMode: 'ask',
  });
  writeFileSync(join(sessionDir, 'session.jsonl'), `${header}\n`);
  return sessionId;
}

describe('legacy session data contract (ADR 0021)', () => {
  it('keeps a v0.15 claude-sdk legacy-path session listed, migrated, and rebased', () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'legacy-contract-'));
    const sessionId = seedLegacyClaudeSdkSession(workspaceRoot);

    const sessions = listSessions(workspaceRoot);
    const restored = sessions.find(session => session.id === sessionId);

    expect(restored).toBeDefined();
    expect(restored?.name).toBe('legacy claude-sdk session');
    // Read-path migrations must all fire without a schemaVersion field:
    expect(restored?.legacyAgentRuntime).toBe('claude-sdk');
    expect(restored?.sessionStatus).toBe('todo'); // todoState rename
    expect(restored?.workspaceRootPath).toBe(workspaceRoot); // root rebase
    expect(restored?.workingDirectory?.startsWith(workspaceRoot)).toBe(true);
  });

  it('keeps a pre-versioned 0.17/0.18 session readable and treats missing schemaVersion as v1', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'legacy-contract-'));
    const sessionId = seedPreVersionedPiSession(workspaceRoot);

    const sessions = listSessions(workspaceRoot);
    const restored = sessions.find(session => session.id === sessionId);

    expect(restored).toBeDefined();
    expect(restored?.schemaVersion).toBeUndefined(); // absent = v1, never rejected
    expect(restored?.sessionStatus).toBe('todo');
    // The non-blocking startup path must agree with the synchronous reader.
    expect(await listSessionsAsync(workspaceRoot)).toEqual(sessions);
  });

  it('lists mixed legacy and current sessions together without dropping either', () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'legacy-contract-'));
    const legacyId = seedLegacyClaudeSdkSession(workspaceRoot);
    const preVersionedId = seedPreVersionedPiSession(workspaceRoot);

    const ids = listSessions(workspaceRoot).map(session => session.id);

    expect(ids).toContain(legacyId);
    expect(ids).toContain(preVersionedId);
  });
});
