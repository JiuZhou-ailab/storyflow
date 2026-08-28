// input: Project Session JSONL candidates pre-created as external symlinks
// output: Regression coverage that sync, queued, and recovery paths never follow them
// pos: Guards the durable Session file replacement boundary

import { afterEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { writeSessionJsonl } from '../jsonl.ts';
import { getSessionFilePath, loadSession, recoverSessionFile, saveSession } from '../storage.ts';
import type { StoredSession } from '../types.ts';

const roots: string[] = [];

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function session(workspaceRootPath: string, id: string): StoredSession {
  return {
    id,
    workspaceRootPath,
    createdAt: 1,
    lastUsedAt: 1,
    messages: [],
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      costUsd: 0,
    },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Session JSONL Project boundary', () => {
  it('still treats an entirely missing Session path as absent', () => {
    expect(loadSession(tempRoot('session-missing-project-'), 'missing')).toBeNull();
  });

  it('does not let the queued writer follow a pre-created temp-file symlink', async () => {
    const projectRoot = tempRoot('session-queue-project-');
    const outsideRoot = tempRoot('session-queue-outside-');
    const stored = session(projectRoot, `session_${randomUUID()}`);
    const sessionFile = getSessionFilePath(projectRoot, stored.id);
    mkdirSync(dirname(sessionFile), { recursive: true });
    const outsideFile = join(outsideRoot, 'outside.jsonl');
    writeFileSync(outsideFile, 'sentinel\n');
    symlinkSync(outsideFile, sessionFile + '.tmp');

    await expect(saveSession(stored)).rejects.toThrow(/symbolic link/);
    expect(readFileSync(outsideFile, 'utf-8')).toBe('sentinel\n');
  });

  it('does not let the synchronous writer follow a pre-created temp-file symlink', () => {
    const projectRoot = tempRoot('session-sync-project-');
    const outsideRoot = tempRoot('session-sync-outside-');
    const stored = session(projectRoot, `session_${randomUUID()}`);
    const sessionFile = getSessionFilePath(projectRoot, stored.id);
    mkdirSync(dirname(sessionFile), { recursive: true });
    const outsideFile = join(outsideRoot, 'outside.jsonl');
    writeFileSync(outsideFile, 'sentinel\n');
    symlinkSync(outsideFile, sessionFile + '.tmp');

    expect(() => writeSessionJsonl(sessionFile, stored, projectRoot)).toThrow(/symbolic link/);
    expect(readFileSync(outsideFile, 'utf-8')).toBe('sentinel\n');
  });

  it('does not let the synchronous writer follow a symlinked Session directory', () => {
    const projectRoot = tempRoot('session-sync-parent-project-');
    const outsideRoot = tempRoot('session-sync-parent-outside-');
    const stored = session(projectRoot, `session_${randomUUID()}`);
    const sessionsDir = join(projectRoot, '.craft-agent', 'sessions');
    const outsideSessionDir = join(outsideRoot, stored.id);
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(outsideSessionDir, { recursive: true });
    symlinkSync(outsideSessionDir, join(sessionsDir, stored.id), 'dir');
    const sessionFile = join(sessionsDir, stored.id, 'session.jsonl');

    expect(() => writeSessionJsonl(sessionFile, stored, projectRoot)).toThrow(/symbolic link/);
    expect(() => readFileSync(join(outsideSessionDir, 'session.jsonl'), 'utf-8')).toThrow();
  });

  it('does not read a committed Session through an external symlink during recovery', () => {
    const projectRoot = tempRoot('session-recovery-project-');
    const outsideRoot = tempRoot('session-recovery-outside-');
    const stored = session(projectRoot, `session_${randomUUID()}`);
    const sessionFile = getSessionFilePath(projectRoot, stored.id);
    mkdirSync(dirname(sessionFile), { recursive: true });
    const outsideFile = join(outsideRoot, 'outside.jsonl');
    writeSessionJsonl(outsideFile, stored, outsideRoot);
    symlinkSync(outsideFile, sessionFile);

    expect(() => recoverSessionFile(sessionFile, projectRoot)).toThrow(/symbolic link/);
  });
});
