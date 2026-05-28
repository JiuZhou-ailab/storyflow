// input: Create-only write operations for Pi tool registration.
// output: Regression coverage for existing-file overwrite prevention.
// pos: Unit tests for Craft's Pi write tool contract.

import { existsSync, rmSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { createCreateOnlyWriteOperations } from './write-tool';

describe('createCreateOnlyWriteOperations', () => {
  it('writes a new file after its parent directory exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-pi-write-new-'));
    const targetPath = join(root, 'notes', 'draft.md');
    const ops = createCreateOnlyWriteOperations();

    try {
      await ops.mkdir(dirname(targetPath));
      await ops.writeFile(targetPath, '# Draft');

      expect(await readFile(targetPath, 'utf-8')).toBe('# Draft');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects existing files without changing their content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-pi-write-existing-'));
    const targetPath = join(root, 'chapter.md');
    const ops = createCreateOnlyWriteOperations();

    try {
      await writeFile(targetPath, 'original', 'utf-8');

      await expect(ops.writeFile(targetPath, 'replacement')).rejects.toThrow('already exists');

      expect(existsSync(targetPath)).toBe(true);
      expect(await readFile(targetPath, 'utf-8')).toBe('original');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
