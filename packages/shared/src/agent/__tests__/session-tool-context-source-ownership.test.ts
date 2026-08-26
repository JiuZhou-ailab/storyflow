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
  loadSource,
} from '../../sources/storage.ts';
import { getSourceGrantRef } from '../../sources/grants.ts';

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
      getHostGrantedSourceRefs: () => [],
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
      getHostGrantedSourceRefs: () => [],
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

  it('requires the exact Host grant and stable Project identity for Source execution', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), `${TEST_PREFIX}-grant-`));
    const sourceSlug = `${TEST_PREFIX}-project-source`;
    const sourceDir = join(workspaceRoot, '.craft-agent', 'sources', sourceSlug);
    const configPath = join(sourceDir, 'config.json');
    touchedPaths.add(workspaceRoot);
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify({
      id: 'source-id',
      slug: sourceSlug,
      name: 'Project Source',
      enabled: true,
      provider: 'test',
      type: 'api',
      api: { baseUrl: 'https://first.example', authType: 'bearer' },
    }));

    const loaded = loadSource(workspaceRoot, sourceSlug, 'project-stable');
    expect(loaded?.workspaceId).toBe('project-stable');
    const exactRef = getSourceGrantRef(loaded!);
    let liveRefs = [exactRef];
    const denied = createSessionToolContext({
      sessionId: 'denied-session',
      workspaceId: 'project-stable',
      workspacePath: workspaceRoot,
      getHostGrantedSourceRefs: () => [],
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
    });
    const granted = createSessionToolContext({
      sessionId: 'granted-session',
      workspaceId: 'project-stable',
      workspacePath: workspaceRoot,
      getHostGrantedSourceRefs: () => liveRefs,
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
    });

    expect(denied.isSourceExecutionAllowed(sourceSlug)).toBe(false);
    expect(granted.isSourceExecutionAllowed(sourceSlug)).toBe(true);

    liveRefs = [];
    expect(granted.isSourceExecutionAllowed(sourceSlug)).toBe(false);
    liveRefs = [exactRef];

    const replacement = JSON.parse(readFileSync(configPath, 'utf-8'));
    replacement.api.baseUrl = 'https://replacement.example';
    writeFileSync(configPath, JSON.stringify(replacement));
    expect(granted.isSourceExecutionAllowed(sourceSlug)).toBe(false);
  });
});
