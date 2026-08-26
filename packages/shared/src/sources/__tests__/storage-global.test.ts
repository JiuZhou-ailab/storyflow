// input: Temporary project roots and isolated Storyflow/external global Source fixtures
// output: Regression coverage for project overlays and explicit global-only discovery
// pos: Source storage boundary excluding implicit third-party agent directories

import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import {
  createSource,
  deleteSource,
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
  // Clean by this run's unique prefix even when createSource fails before its
  // slug is returned to the caller.
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

    const sources = loadWorkspaceSources(workspaceRoot, 'project-stable')
      .filter(source => source.config.slug.startsWith(TEST_PREFIX));

    expect(sources.map(source => source.config.slug).sort()).toEqual([
      craftGlobalOnlySlug,
      sharedSlug,
      workspaceOnlySlug,
    ].sort());
    expect(sources.find(source => source.config.slug === sharedSlug)?.config.name).toBe('Workspace Shared');
    expect(sources.find(source => source.config.slug === sharedSlug)?.workspaceId).toBe('project-stable');
    expect(sources.find(source => source.config.slug === sharedSlug)?.definitionIdentity).toMatch(/^[a-f0-9]{64}$/);
    expect(sources.find(source => source.config.slug === craftGlobalOnlySlug)?.origin).toBe('craft-global');
    expect(sources.find(source => source.config.slug === craftGlobalOnlySlug)?.workspaceId).toBe('global');
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

  it('rejects Source slug traversal before deleting Project state', () => {
    const workspaceRoot = makeWorkspaceRoot('delete-boundary');
    const stateDir = join(workspaceRoot, '.craft-agent');
    const configPath = join(stateDir, 'config.json');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(configPath, '{"id":"keep"}');

    expect(() => deleteSource(workspaceRoot, '..')).toThrow('Invalid Source slug');
    expect(existsSync(configPath)).toBe(true);
  });

  it('ignores folder/config slug mismatches and never falls through to global deletion', () => {
    const workspaceRoot = makeWorkspaceRoot('owner-boundary');
    const globalSlug = `${TEST_PREFIX}-global-owner`;
    const attackerFolder = `${TEST_PREFIX}-attacker-folder`;
    writeSource(GLOBAL_AGENT_ROOT_DIR, globalSlug, 'Global Owner');
    touchedGlobalSlugs.add(globalSlug);

    const attackerDir = join(workspaceRoot, '.craft-agent', 'sources', attackerFolder);
    mkdirSync(attackerDir, { recursive: true });
    writeFileSync(join(attackerDir, 'config.json'), JSON.stringify({
      id: 'attacker',
      slug: globalSlug,
      name: 'Mismatched Project Source',
      enabled: true,
      provider: 'test',
      type: 'api',
      api: { baseUrl: 'https://attacker.example', authType: 'none' },
    }));

    const visible = loadWorkspaceSources(workspaceRoot, 'project-stable')
      .find(source => source.config.slug === globalSlug);
    expect(visible?.origin).toBe('craft-global');

    deleteSource(workspaceRoot, globalSlug);
    expect(existsSync(join(attackerDir, 'config.json'))).toBe(true);
    expect(existsSync(join(GLOBAL_SOURCES_DIR, globalSlug, 'config.json'))).toBe(true);
  });

  it('rejects Project Source symlinks without touching the external target', () => {
    const workspaceRoot = makeWorkspaceRoot('symlink-boundary');
    const outsideRoot = makeWorkspaceRoot('symlink-outside');
    const outsideSource = join(outsideRoot, 'outside-source');
    const outsideConfig = join(outsideSource, 'config.json');
    mkdirSync(outsideSource, { recursive: true });
    writeFileSync(outsideConfig, '{"id":"keep"}');
    mkdirSync(join(workspaceRoot, '.craft-agent'), { recursive: true });
    symlinkSync(outsideRoot, join(workspaceRoot, '.craft-agent', 'sources'));

    expect(() => loadWorkspaceSources(workspaceRoot, 'project-symlink')).toThrow('symbolic link');
    expect(() => deleteSource(workspaceRoot, 'outside-source')).toThrow('symbolic link');
    expect(existsSync(outsideConfig)).toBe(true);
  });
});
