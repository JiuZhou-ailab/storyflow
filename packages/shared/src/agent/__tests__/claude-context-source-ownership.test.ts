// input: Temporary workspace plus a real-home shared Source definition fixture
// output: Cross-layer proof that SessionToolContext projects status without mutating shared definitions
// pos: Adapter regression test between source_test contracts and Source ownership storage

import { afterEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SourceConfig } from '@craft-agent/session-tools-core';
import { createClaudeContext } from '../claude-context.ts';
import {
  loadSource,
  SHARED_AGENTS_SOURCES_DIR,
  SHARED_SOURCE_RUNTIME_STATE_DIR,
} from '../../sources/storage.ts';
import { getWorkspaceSourcesPath } from '../../workspaces/paths.ts';

const TEST_PREFIX = `claude-context-source-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const touchedPaths = new Set<string>();

afterEach(() => {
  for (const path of touchedPaths) {
    rmSync(path, { recursive: true, force: true });
  }
  touchedPaths.clear();
});

describe('Claude SessionToolContext Source ownership', () => {
  it('loads a shared definition and persists only normalized Craft runtime state', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), `${TEST_PREFIX}-workspace-`));
    const slug = `${TEST_PREFIX}-shared`;
    const sharedSourceDir = join(SHARED_AGENTS_SOURCES_DIR, slug);
    const sharedConfigPath = join(sharedSourceDir, 'config.json');
    const runtimeStatePath = join(
      SHARED_SOURCE_RUNTIME_STATE_DIR,
      `${encodeURIComponent(slug)}.json`,
    );
    touchedPaths.add(workspaceRoot);
    touchedPaths.add(sharedSourceDir);
    touchedPaths.add(runtimeStatePath);

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
    const loaded = context.loadSourceConfig(slug)!;
    expect(context.isSourceDefinitionReadOnly?.(slug)).toBe(true);

    context.saveSourceConfig?.({
      ...loaded,
      name: 'Attempted Mutation',
      enabled: true,
      connectionStatus: 'error',
      connectionError: 'Probe failed',
      lastTestedAt: 123,
    } as SourceConfig);

    expect(readFileSync(sharedConfigPath)).toEqual(originalDefinition);
    expect(existsSync(join(getWorkspaceSourcesPath(workspaceRoot), slug, 'config.json'))).toBe(false);

    const projected = loadSource(workspaceRoot, slug)!;
    expect(projected.origin).toBe('shared-global');
    expect(projected.config.name).toBe('Externally Owned');
    expect(projected.config.enabled).toBe(false);
    expect(projected.config.connectionStatus).toBe('failed');
    expect(projected.config.connectionError).toBe('Probe failed');
    expect(projected.config.lastTestedAt).toBe(123);
  });
});
