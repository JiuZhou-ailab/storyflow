// input: Temporary workspace roots and real ~/.agents/sources test fixtures
// output: Regression coverage for global default source storage and merged visibility
// pos: Source storage behavior test for global reusable source definitions

import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import {
  createSource,
  loadWorkspaceSources,
  type FolderSourceConfig,
} from '../index.ts';
import { getWorkspaceSourcesPath } from '../../workspaces/storage.ts';

const TEST_PREFIX = `storage-global-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const GLOBAL_SOURCES_DIR = join(homedir(), '.agents', 'sources');

const touchedGlobalSlugs = new Set<string>();
const touchedTempRoots = new Set<string>();

function makeWorkspaceRoot(name: string): string {
  const root = join(tmpdir(), `${TEST_PREFIX}-${name}`);
  mkdirSync(root, { recursive: true });
  touchedTempRoots.add(root);
  return root;
}

function writeSource(root: string, slug: string, name: string): void {
  const sourceDir = join(root, 'sources', slug);
  mkdirSync(sourceDir, { recursive: true });
  const config: FolderSourceConfig = {
    id: `${slug}_test`,
    name,
    slug,
    enabled: true,
    provider: 'test',
    type: 'local',
    local: { path: root },
  };
  writeFileSync(join(sourceDir, 'config.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(sourceDir, 'guide.md'), `# ${name}\n`);
}

afterEach(() => {
  for (const slug of touchedGlobalSlugs) {
    rmSync(join(GLOBAL_SOURCES_DIR, slug), { recursive: true, force: true });
  }
  touchedGlobalSlugs.clear();

  for (const root of touchedTempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  touchedTempRoots.clear();
});

describe('global source storage', () => {
  it('creates new sources in the global agents sources directory by default', async () => {
    const workspaceRoot = makeWorkspaceRoot('create-default-global');
    const sourceName = `${TEST_PREFIX} Default Global`;

    const config = await createSource(workspaceRoot, {
      name: sourceName,
      provider: 'test',
      type: 'local',
      local: { path: workspaceRoot },
    });
    touchedGlobalSlugs.add(config.slug);

    expect(existsSync(join(GLOBAL_SOURCES_DIR, config.slug, 'config.json'))).toBe(true);
    expect(existsSync(join(getWorkspaceSourcesPath(workspaceRoot), config.slug, 'config.json'))).toBe(false);
  });

  it('loads global sources alongside workspace sources and lets workspace override by slug', () => {
    const workspaceRoot = makeWorkspaceRoot('merge-global-workspace');
    const sharedSlug = `${TEST_PREFIX}-shared`;
    const workspaceOnlySlug = `${TEST_PREFIX}-workspace`;
    const globalOnlySlug = `${TEST_PREFIX}-global`;

    writeSource(join(homedir(), '.agents'), sharedSlug, 'Global Shared');
    writeSource(join(homedir(), '.agents'), globalOnlySlug, 'Global Only');
    touchedGlobalSlugs.add(sharedSlug);
    touchedGlobalSlugs.add(globalOnlySlug);

    writeSource(workspaceRoot, sharedSlug, 'Workspace Shared');
    writeSource(workspaceRoot, workspaceOnlySlug, 'Workspace Only');

    const sources = loadWorkspaceSources(workspaceRoot)
      .filter(source => source.config.slug.startsWith(TEST_PREFIX));

    expect(sources.map(source => source.config.slug).sort()).toEqual([
      globalOnlySlug,
      sharedSlug,
      workspaceOnlySlug,
    ].sort());
    expect(sources.find(source => source.config.slug === sharedSlug)?.config.name).toBe('Workspace Shared');
    expect(sources.find(source => source.config.slug === globalOnlySlug)?.source).toBe('global');
    expect(sources.find(source => source.config.slug === workspaceOnlySlug)?.source).toBe('workspace');
  });
});
