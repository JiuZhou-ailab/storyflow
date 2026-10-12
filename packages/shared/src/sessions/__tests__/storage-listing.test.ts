// input: Temporary workspaces with persisted session JSONL files
// output: Listing parity, recovery safety, and a budget for redundant filesystem checks
// pos: Guards startup session listing at the filesystem and Project boundaries

import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession, deleteSession, getSessionFilePath, listSessions, listSessionsAsync, loadSession, setSessionFileReplacementActive } from '../storage.ts';

let workspaceRoot: string | undefined;
let otherWorkspaceRoot: string | undefined;
let externalRoot: string | undefined;

afterEach(() => {
  if (workspaceRoot) rmSync(workspaceRoot, { recursive: true, force: true });
  if (otherWorkspaceRoot) rmSync(otherWorkspaceRoot, { recursive: true, force: true });
  if (externalRoot) rmSync(externalRoot, { recursive: true, force: true });
  workspaceRoot = undefined;
  otherWorkspaceRoot = undefined;
  externalRoot = undefined;
});

describe('session storage listing', () => {
  it('does not repeatedly canonicalize absent recovery candidates while listing clean sessions', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'session-listing-io-'));
    for (let index = 0; index < 64; index++) {
      const id = `session-${String(index).padStart(2, '0')}`;
      const directory = join(workspaceRoot, '.craft-agent', 'sessions', id);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'session.jsonl'), JSON.stringify({
        id, workspaceRootPath: workspaceRoot, createdAt: 1, lastUsedAt: index,
        messageCount: 0,
      }) + '\n');
    }
    const canonicalize = spyOn(fs, 'realpathSync');
    try {
      const sessions = await listSessionsAsync(workspaceRoot);
      expect(sessions.map(session => session.id)).toEqual(
        Array.from({ length: 64 }, (_, index) => `session-${String(63 - index).padStart(2, '0')}`),
      );
      // One recovery guard and one plan-directory guard per Session, plus root discovery.
      expect(canonicalize.mock.calls.filter(([path]) => path === workspaceRoot).length).toBeLessThanOrEqual(64 * 2 + 2);
    } finally {
      canonicalize.mockRestore();
    }
  });

  it('returns the same metadata through the non-blocking startup path', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'session-listing-'));
    await createSession(workspaceRoot, { name: 'first' });
    await createSession(workspaceRoot, { name: 'second' });

    expect(await listSessionsAsync(workspaceRoot)).toEqual(listSessions(workspaceRoot));
  });

  it.each(['.tmp', '.bak'])('rejects dangling %s symlinks during listing', async (suffix) => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'session-listing-link-'));
    const created = await createSession(workspaceRoot);
    const file = getSessionFilePath(workspaceRoot, created.id);
    symlinkSync(join(workspaceRoot, 'missing-file'), file + suffix);

    await expect(listSessionsAsync(workspaceRoot)).rejects.toThrow(/symbolic link/);
  });

  it('lists the committed backup during an active replacement without promoting a partial temp file', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'session-listing-replacement-'));
    const created = await createSession(workspaceRoot, { name: 'committed' });
    const file = getSessionFilePath(workspaceRoot, created.id);
    renameSync(file, file + '.bak');
    writeFileSync(file + '.tmp', '{"id":');
    setSessionFileReplacementActive(file, true);
    try {
      expect(await listSessionsAsync(workspaceRoot)).toMatchObject([{ id: created.id, name: 'committed' }]);
      expect(existsSync(file)).toBe(false);
      expect(existsSync(file + '.bak')).toBe(true);
    } finally {
      setSessionFileReplacementActive(file, false);
    }
  });

  it('generates host-wide unique ids across Project roots', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'session-listing-a-'));
    otherWorkspaceRoot = mkdtempSync(join(tmpdir(), 'session-listing-b-'));

    const [first, second] = await Promise.all([
      createSession(workspaceRoot, { name: 'first' }),
      createSession(otherWorkspaceRoot, { name: 'second' }),
    ]);

    expect(first.id).not.toBe(second.id);
  });

  it('persists pin state independently from the automation-facing flag state', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'session-pinned-'));
    const created = await createSession(workspaceRoot, { isPinned: true, isFlagged: false });

    const restored = loadSession(workspaceRoot, created.id);
    expect(restored?.isPinned).toBe(true);
    expect(restored?.isFlagged).toBe(false);
  });

  it('refuses to delete through a Project sessions-directory symlink', () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'session-delete-symlink-'));
    externalRoot = mkdtempSync(join(tmpdir(), 'session-delete-external-'));
    const externalSession = join(externalRoot, 'session-1');
    const sentinel = join(externalSession, 'keep.txt');
    mkdirSync(join(workspaceRoot, '.craft-agent'), { recursive: true });
    mkdirSync(externalSession, { recursive: true });
    writeFileSync(sentinel, 'keep');
    symlinkSync(
      externalRoot,
      join(workspaceRoot, '.craft-agent', 'sessions'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    expect(deleteSession(workspaceRoot, 'session-1')).toBe(false);
    expect(existsSync(sentinel)).toBe(true);
  });
});
