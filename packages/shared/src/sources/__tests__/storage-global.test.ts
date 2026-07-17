// input: Temporary workspace roots and real ~/.craft-agent/sources test fixtures
// output: Regression coverage for global default source storage and merged visibility
// pos: Source storage behavior test for global reusable source definitions

import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import {
  createSource,
  deleteSource,
  ensureSourcesDir,
  isSourceUsable,
  loadSource,
  loadSourceConfig,
  loadWorkspaceSources,
  markSourceAuthenticated,
  ReadOnlySourceDefinitionError,
  SHARED_AGENTS_ROOT_DIR,
  SHARED_SOURCE_RUNTIME_STATE_DIR,
  saveSourceConfig,
  saveSourceGuide,
  SourceCredentialManager,
  type FolderSourceConfig,
} from '../index.ts';
import { getWorkspaceSourcesPath } from '../../workspaces/storage.ts';

const TEST_PREFIX = `storage-global-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const GLOBAL_SOURCES_DIR = join(homedir(), '.craft-agent', 'sources');
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
  for (const slug of touchedGlobalSlugs) {
    rmSync(join(GLOBAL_SOURCES_DIR, slug), { recursive: true, force: true });
  }
  touchedGlobalSlugs.clear();

  for (const slug of touchedSharedSlugs) {
    rmSync(join(SHARED_AGENTS_SOURCES_DIR, slug), { recursive: true, force: true });
    rmSync(join(SHARED_SOURCE_RUNTIME_STATE_DIR, `${encodeURIComponent(slug)}.json`), { force: true });
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
  });

  it('loads craft and shared globals alongside workspace sources and lets workspace override by slug', () => {
    const workspaceRoot = makeWorkspaceRoot('merge-global-workspace');
    const sharedSlug = `${TEST_PREFIX}-shared`;
    const workspaceOnlySlug = `${TEST_PREFIX}-workspace`;
    const craftGlobalOnlySlug = `${TEST_PREFIX}-craft-global`;
    const sharedAgentsOnlySlug = `${TEST_PREFIX}-shared-agents`;

    writeSource(join(homedir(), '.craft-agent'), craftGlobalOnlySlug, 'Craft Global Only');
    writeSource(join(homedir(), '.craft-agent'), sharedSlug, 'Craft Shared');
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
      sharedAgentsOnlySlug,
      sharedSlug,
      workspaceOnlySlug,
    ].sort());
    expect(sources.find(source => source.config.slug === sharedSlug)?.config.name).toBe('Workspace Shared');
    expect(sources.find(source => source.config.slug === craftGlobalOnlySlug)?.origin).toBe('craft-global');
    expect(sources.find(source => source.config.slug === sharedAgentsOnlySlug)?.origin).toBe('shared-global');
    expect(sources.find(source => source.config.slug === workspaceOnlySlug)?.origin).toBe('workspace');
  });

  it('keeps shared definitions byte-identical while projecting Craft-owned auth state', () => {
    const workspaceRoot = makeWorkspaceRoot('shared-auth-state');
    const slug = `${TEST_PREFIX}-shared-auth-state`;
    const configPath = join(SHARED_AGENTS_SOURCES_DIR, slug, 'config.json');
    const guidePath = join(SHARED_AGENTS_SOURCES_DIR, slug, 'guide.md');
    writeSource(SHARED_AGENTS_ROOT_DIR, slug, 'Shared Auth State', { requiresAuth: true });
    touchedSharedSlugs.add(slug);

    const originalConfig = readFileSync(configPath);
    const originalGuide = readFileSync(guidePath);

    expect(markSourceAuthenticated(workspaceRoot, slug)).toBe(true);
    expect(readFileSync(configPath)).toEqual(originalConfig);
    expect(readFileSync(guidePath)).toEqual(originalGuide);

    const authenticated = loadSource(workspaceRoot, slug);
    expect(authenticated?.origin).toBe('shared-global');
    expect(authenticated).not.toBeNull();
    expect(isSourceUsable(authenticated!)).toBe(true);
    expect(authenticated?.config.connectionStatus).toBe('connected');

    const credentialManager = new SourceCredentialManager();
    credentialManager.markSourceNeedsReauth(authenticated!, 'Token expired');

    expect(readFileSync(configPath)).toEqual(originalConfig);
    expect(readFileSync(guidePath)).toEqual(originalGuide);
    const needsAuth = loadSource(workspaceRoot, slug);
    expect(needsAuth).not.toBeNull();
    expect(isSourceUsable(needsAuth!)).toBe(false);
    expect(needsAuth?.config.connectionStatus).toBe('needs_auth');
    expect(needsAuth?.config.connectionError).toBe('Token expired');
  });

  it('rejects deletion of shared definitions without touching external data', () => {
    const workspaceRoot = makeWorkspaceRoot('shared-delete');
    const slug = `${TEST_PREFIX}-shared-delete`;
    const configPath = join(SHARED_AGENTS_SOURCES_DIR, slug, 'config.json');
    const guidePath = join(SHARED_AGENTS_SOURCES_DIR, slug, 'guide.md');
    writeSource(SHARED_AGENTS_ROOT_DIR, slug, 'Shared Delete');
    touchedSharedSlugs.add(slug);
    const originalConfig = readFileSync(configPath);
    const originalGuide = readFileSync(guidePath);

    const config = loadSourceConfig(SHARED_AGENTS_ROOT_DIR, slug)!;
    expect(() => ensureSourcesDir(SHARED_AGENTS_ROOT_DIR))
      .toThrow(ReadOnlySourceDefinitionError);
    expect(() => saveSourceConfig(SHARED_AGENTS_ROOT_DIR, { ...config, name: 'Mutated' }))
      .toThrow(ReadOnlySourceDefinitionError);
    expect(() => saveSourceGuide(SHARED_AGENTS_ROOT_DIR, slug, { raw: '# Mutated\n' }))
      .toThrow(ReadOnlySourceDefinitionError);

    expect(() => deleteSource(workspaceRoot, slug)).toThrow(ReadOnlySourceDefinitionError);
    expect(readFileSync(configPath)).toEqual(originalConfig);
    expect(readFileSync(guidePath)).toEqual(originalGuide);
  });

  it('continues to persist connection state for workspace and Craft-global definitions', () => {
    const workspaceRoot = makeWorkspaceRoot('owned-auth-state');
    const workspaceSlug = `${TEST_PREFIX}-workspace-auth`;
    const globalSlug = `${TEST_PREFIX}-global-auth`;
    writeSource(workspaceRoot, workspaceSlug, 'Workspace Auth');
    writeSource(join(homedir(), '.craft-agent'), globalSlug, 'Global Auth');
    touchedGlobalSlugs.add(globalSlug);

    expect(markSourceAuthenticated(workspaceRoot, workspaceSlug)).toBe(true);
    expect(markSourceAuthenticated(workspaceRoot, globalSlug)).toBe(true);

    expect(loadSource(workspaceRoot, workspaceSlug)?.config.connectionStatus).toBe('connected');
    expect(loadSource(workspaceRoot, globalSlug)?.config.connectionStatus).toBe('connected');
    expect(loadSource(workspaceRoot, workspaceSlug)?.origin).toBe('workspace');
    expect(loadSource(workspaceRoot, globalSlug)?.origin).toBe('craft-global');
  });
});
