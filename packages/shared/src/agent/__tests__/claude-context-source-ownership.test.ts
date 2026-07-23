// input: Temporary project plus a third-party ~/.agents Source fixture
// output: Proof that SessionToolContext ignores resources outside Storyflow-owned roots
// pos: Regression test for the explicit Resource Resolver ownership boundary

import { afterEach, describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClaudeContext } from '../claude-context.ts';
import {
  SHARED_AGENTS_SOURCES_DIR,
} from '../../sources/storage.ts';

const TEST_PREFIX = `claude-context-source-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const touchedPaths = new Set<string>();

afterEach(() => {
  for (const path of touchedPaths) {
    rmSync(path, { recursive: true, force: true });
  }
  touchedPaths.clear();
});

describe('Claude SessionToolContext Source ownership', () => {
  it('does not discover a Source from ~/.agents implicitly', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), `${TEST_PREFIX}-workspace-`));
    const slug = `${TEST_PREFIX}-shared`;
    const sharedSourceDir = join(SHARED_AGENTS_SOURCES_DIR, slug);
    const sharedConfigPath = join(sharedSourceDir, 'config.json');
    touchedPaths.add(workspaceRoot);
    touchedPaths.add(sharedSourceDir);

    mkdirSync(sharedSourceDir, { recursive: true });
    writeFileSync(sharedConfigPath, JSON.stringify({
      id: `${slug}-id`,
      slug,
      name: 'Externally Owned',
      enabled: false,
      provider: 'test',
      type: 'mcp',
      mcp: { transport: 'stdio', command: 'echo' },
    }, null, 2));
    const originalDefinition = readFileSync(sharedConfigPath);

    const context = createClaudeContext({
      sessionId: 'test-session',
      workspaceId: 'test-workspace',
      workspacePath: workspaceRoot,
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
    });
    expect(context.loadSourceConfig(slug)).toBeUndefined();
    expect(context.isSourceDefinitionReadOnly?.(slug)).toBe(false);
    expect(readFileSync(sharedConfigPath)).toEqual(originalDefinition);
  });
});
