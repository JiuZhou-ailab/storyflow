// input: Monorepo root cwd and Electron source resources
// output: Dev asset resolution without a prior build:copy step
// pos: Guards product defaults in the root-level electron:dev workflow

import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { getBundledAssetsDir } from '../paths.ts';

describe('getBundledAssetsDir', () => {
  it('finds Electron source assets when dev runs from the monorepo root', () => {
    const originalCwd = process.cwd();
    const repoRoot = resolve(import.meta.dir, '../../../../..');

    try {
      process.chdir(repoRoot);
      expect(getBundledAssetsDir('agent-defaults')).toBe(
        resolve(repoRoot, 'apps/electron/resources/agent-defaults'),
      );
    } finally {
      process.chdir(originalCwd);
    }
  });
});
