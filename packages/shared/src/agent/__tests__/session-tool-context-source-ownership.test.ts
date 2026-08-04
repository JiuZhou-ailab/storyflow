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
import { createSessionToolContext } from '../session-tool-context.ts';
import { CONFIG_DIR } from '../../config/paths.ts';
import { getPiUserSkillsDir } from '../../skills/storage.ts';
import {
  SHARED_AGENTS_SOURCES_DIR,
} from '../../sources/storage.ts';

const TEST_PREFIX = `pi-context-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const touchedPaths = new Set<string>();

afterEach(() => {
  for (const path of touchedPaths) {
    rmSync(path, { recursive: true, force: true });
  }
  touchedPaths.clear();
});

describe('Pi SessionToolContext Source ownership', () => {
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

    const context = createSessionToolContext({
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

  it('creates and resolves Skills globally from every project context', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), `${TEST_PREFIX}-skills-`));
    const slug = `${TEST_PREFIX}-global-skill`;
    const globalSkillDir = join(getPiUserSkillsDir(), slug);
    touchedPaths.add(workspaceRoot);
    touchedPaths.add(globalSkillDir);

    const projectContext = createSessionToolContext({
      sessionId: 'project-session',
      workspaceId: 'project-workspace',
      workspacePath: workspaceRoot,
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
    });
    const content = `---
name: ${slug}
description: "Check a project when asked."
---

# Project check

Inspect the current project evidence.
`;
    const created = await projectContext.createSkillDocument?.(slug, content);
    expect(created?.path).toBe(join(globalSkillDir, 'SKILL.md'));
    expect(projectContext.loadSkillDocument?.(slug)?.content).toBe(content);
    expect(projectContext.skillsPath).toBe(getPiUserSkillsDir());
  });
});
