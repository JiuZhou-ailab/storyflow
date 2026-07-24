// input: Temporary project roots and isolated Storyflow/external global Source fixtures
// output: Regression coverage for project overlays and explicit global-only discovery
// pos: Source storage boundary excluding implicit third-party agent directories

import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import {
  createSource,
  GLOBAL_AGENT_ROOT_DIR,
  loadSource,
  loadWorkspaceSources,
  markSourceAuthenticated,
  type FolderSourceConfig,
} from '../index.ts';
import { getWorkspaceSourcesPath } from '../../workspaces/storage.ts';

const TEST_PREFIX = `storage-global-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const GLOBAL_SOURCES_DIR = join(GLOBAL_AGENT_ROOT_DIR, 'sources');
const SHARED_AGENTS_SOURCES_DIR = join(homedir(), '.agents', 'sources');

const touchedGlobalSlugs = new Set<string>();
const touchedSharedSlugs = new Set<string>();
const touchedTempRoots = new Set<string>();

function makeWorkspaceRoot(name: string): string {
  const root = join(tmpdir(), `${TEST_PREFIX}-${name}`);
  mkdirSync(root, { recursive: true });
  touchedTempRoots.add(root);
  return root;
}

function writeSource(
  root: string,
  slug: string,
  name: string,
  options: { requiresAuth?: boolean } = {},
): void {
  const sourceDir = join(root, 'sources', slug);
  mkdirSync(sourceDir, { recursive: true });
  const baseConfig = {
    id: `${slug}_test`,
    name,
    slug,
    enabled: true,
    provider: 'test',
  };
  const config: FolderSourceConfig = options.requiresAuth
    ? {
        ...baseConfig,
        type: 'api',
        api: { baseUrl: 'https://example.test', authType: 'bearer' },
      }
    : {
        ...baseConfig,
        type: 'local',
        local: { path: root },
      };
  writeFileSync(join(sourceDir, 'config.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(sourceDir, 'guide.md'), `# ${name}\n`);
}

afterEach(() => {
  // createSource writes config before optional icon discovery completes. If the
  // async test times out in that window, its slug is not returned to the caller,
  // so clean by this run's unique prefix as a final isolation boundary.
  for (const root of [GLOBAL_SOURCES_DIR, SHARED_AGENTS_SOURCES_DIR]) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith(TEST_PREFIX)) {
        rmSync(join(root, entry.name), { recursive: true, force: true });
      }
    }
  }

  for (const slug of touchedGlobalSlugs) {
    rmSync(join(GLOBAL_SOURCES_DIR, slug), { recursive: true, force: true });
  }
  touchedGlobalSlugs.clear();

  for (const slug of touchedSharedSlugs) {
    rmSync(join(SHARED_AGENTS_SOURCES_DIR, slug), { recursive: true, force: true });
  }
  touchedSharedSlugs.clear();

  for (const root of touchedTempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  touchedTempRoots.clear();
});

describe('global source storage', () => {
  it('creates new sources in the Craft global sources directory by default', async () => {
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
    expect(existsSync(join(SHARED_AGENTS_SOURCES_DIR, config.slug, 'config.json'))).toBe(false);
    expect(existsSync(join(getWorkspaceSourcesPath(workspaceRoot), config.slug, 'config.json'))).toBe(false);
  }, 15_000);

  it('loads project and Craft globals, lets the project override, and ignores ~/.agents', () => {
    const workspaceRoot = makeWorkspaceRoot('merge-global-workspace');
    const sharedSlug = `${TEST_PREFIX}-shared`;
    const workspaceOnlySlug = `${TEST_PREFIX}-workspace`;
    const craftGlobalOnlySlug = `${TEST_PREFIX}-craft-global`;
    const sharedAgentsOnlySlug = `${TEST_PREFIX}-shared-agents`;

    writeSource(GLOBAL_AGENT_ROOT_DIR, craftGlobalOnlySlug, 'Craft Global Only');
    writeSource(GLOBAL_AGENT_ROOT_DIR, sharedSlug, 'Craft Shared');
    writeSource(join(homedir(), '.agents'), sharedAgentsOnlySlug, 'Shared Agents Only');
    touchedGlobalSlugs.add(sharedSlug);
    touchedGlobalSlugs.add(craftGlobalOnlySlug);
    touchedSharedSlugs.add(sharedAgentsOnlySlug);

    writeSource(workspaceRoot, sharedSlug, 'Workspace Shared');
    writeSource(workspaceRoot, workspaceOnlySlug, 'Workspace Only');

    const sources = loadWorkspaceSources(workspaceRoot)
      .filter(source => source.config.slug.startsWith(TEST_PREFIX));

    expect(sources.map(source => source.config.slug).sort()).toEqual([
      craftGlobalOnlySlug,
      sharedSlug,
      workspaceOnlySlug,
    ].sort());
    expect(sources.find(source => source.config.slug === sharedSlug)?.config.name).toBe('Workspace Shared');
    expect(sources.find(source => source.config.slug === craftGlobalOnlySlug)?.origin).toBe('craft-global');
    expect(sources.find(source => source.config.slug === sharedAgentsOnlySlug)).toBeUndefined();
    expect(sources.find(source => source.config.slug === workspaceOnlySlug)?.origin).toBe('workspace');
  });

  it('loads only global Sources when projectRoot is absent', () => {
    const globalSlug = `${TEST_PREFIX}-free-global`;
    const projectSlug = `${TEST_PREFIX}-free-project`;
    const projectRoot = makeWorkspaceRoot('free-scope');
    writeSource(GLOBAL_AGENT_ROOT_DIR, globalSlug, 'Free Global');
    writeSource(projectRoot, projectSlug, 'Project Only');
    touchedGlobalSlugs.add(globalSlug);

    const sources = loadWorkspaceSources()
      .filter(source => source.config.slug.startsWith(TEST_PREFIX));

    expect(sources.find(source => source.config.slug === globalSlug)?.origin).toBe('craft-global');
    expect(sources.find(source => source.config.slug === projectSlug)).toBeUndefined();
  });

  it('continues to persist connection state for workspace and Craft-global definitions', () => {
    const workspaceRoot = makeWorkspaceRoot('owned-auth-state');
    const workspaceSlug = `${TEST_PREFIX}-workspace-auth`;
    const globalSlug = `${TEST_PREFIX}-global-auth`;
    writeSource(workspaceRoot, workspaceSlug, 'Workspace Auth');
    writeSource(GLOBAL_AGENT_ROOT_DIR, globalSlug, 'Global Auth');
    touchedGlobalSlugs.add(globalSlug);

    expect(markSourceAuthenticated(workspaceRoot, workspaceSlug)).toBe(true);
    expect(markSourceAuthenticated(workspaceRoot, globalSlug)).toBe(true);

    expect(loadSource(workspaceRoot, workspaceSlug)?.config.connectionStatus).toBe('connected');
    expect(loadSource(workspaceRoot, globalSlug)?.config.connectionStatus).toBe('connected');
    expect(loadSource(workspaceRoot, workspaceSlug)?.origin).toBe('workspace');
    expect(loadSource(workspaceRoot, globalSlug)?.origin).toBe('craft-global');
  });
});
