// input: Temporary workspaces with persisted session JSONL files
// output: Behavioral parity between synchronous and non-blocking session listing
// pos: Regression check for startup session restoration without main-thread filesystem reads

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession, listSessions, listSessionsAsync } from '../storage.ts';

let workspaceRoot: string | undefined;

afterEach(() => {
  if (workspaceRoot) rmSync(workspaceRoot, { recursive: true, force: true });
  workspaceRoot = undefined;
});

describe('session storage listing', () => {
  it('returns the same metadata through the non-blocking startup path', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'session-listing-'));
    await createSession(workspaceRoot, { name: 'first' });
    await createSession(workspaceRoot, { name: 'second' });

    expect(await listSessionsAsync(workspaceRoot)).toEqual(listSessions(workspaceRoot));
  });
});
