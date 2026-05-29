// input: Temporary writing workspace roots and Bash commands
// output: Assertions for blocking shell writes that bypass writing diffs
// pos: Focused guard tests for the centralized PreToolUse writing boundary

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getWritingProjectBashWriteRedirect } from '../pre-tool-use.ts';

const roots: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'craft-writing-bash-guard-'));
  roots.push(root);
  return root;
}

function writeWritingManifest(root: string): void {
  writeFileSync(join(root, 'craft-writing.json'), JSON.stringify({
    schemaVersion: 1,
    type: 'short-form',
  }));
}

describe('getWritingProjectBashWriteRedirect', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('blocks Bash redirects to reviewable writing workspace text files', () => {
    const root = makeTempRoot();
    writeWritingManifest(root);

    const result = getWritingProjectBashWriteRedirect(
      { command: "cat > 正文/第01章.md <<'EOF'\nText\nEOF" },
      root,
      root,
    );

    expect(result?.message).toContain('bypass reviewable diffs');
    expect(result?.message).toContain('正文/第01章.md');
    expect(result?.message).toContain('Use Edit, MultiEdit, or Write');
  });

  it('does not block Bash redirects outside writing projects', () => {
    const root = makeTempRoot();

    const result = getWritingProjectBashWriteRedirect(
      { command: 'cat > README.md' },
      root,
      root,
    );

    expect(result).toBeNull();
  });

  it('does not block scratch writes in writing work folders', () => {
    const root = makeTempRoot();
    writeWritingManifest(root);

    const result = getWritingProjectBashWriteRedirect(
      { command: 'cat > .work/scratch.md' },
      root,
      root,
    );

    expect(result).toBeNull();
  });
});
