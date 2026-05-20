// input: Electron main process build entrypoints
// output: Regression coverage for dependencies that must stay external
// pos: Protects runtime-sensitive Electron main build configuration

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const rootDir = join(import.meta.dir, '..', '..');
const CLAUDE_AGENT_SDK_EXTERNAL = '@anthropic-ai/claude-agent-sdk';
const CLAUDE_AGENT_SDK_EXTERNAL_ARG = '--external:@anthropic-ai/claude-agent-sdk';

function readRepoFile(path: string): string {
  return readFileSync(join(rootDir, path), 'utf8');
}

describe('Electron main process build config', () => {
  test('keeps Claude Agent SDK external in CLI-based main build paths', () => {
    const checkedFiles = [
      'scripts/electron-build-main.ts',
      'scripts/build/win32.ts',
      'apps/electron/package.json',
      'apps/electron/scripts/build-win.ps1',
    ];

    for (const file of checkedFiles) {
      expect(readRepoFile(file), file).toContain(CLAUDE_AGENT_SDK_EXTERNAL_ARG);
    }
  });

  test('keeps Claude Agent SDK external in dev esbuild config', () => {
    expect(readRepoFile('scripts/electron-dev.ts')).toContain(CLAUDE_AGENT_SDK_EXTERNAL);
  });
});
