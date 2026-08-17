// input: Bundled product Skills, default Sources, and optional resource-root overrides
// output: Best-effort Pi user Skill and Storyflow Source seeding
// pos: Resource bootstrap for the minimal Storyflow product defaults

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getBundledAssetsDir } from '../utils/paths.ts';
import { getPiUserSkillsDir } from '../skills/storage.ts';
import { DEFAULT_GLOBAL_AGENT_SKILL_SLUGS } from './skill-defaults.ts';

export { DEFAULT_GLOBAL_AGENT_SKILL_SLUGS, isDefaultGlobalAgentSkillSlug } from './skill-defaults.ts';

export const DEFAULT_AGENT_SOURCE_SLUGS = [
  'storyflow-catalog',
  'wangwen-bigdata',
] as const;

/** Craft app data root. Seeded product resources live under this tree only. */
export const CRAFT_AGENT_ROOT_DIR = join(homedir(), '.craft-agent');

export interface SeedDefaultAgentResourcesOptions {
  assetsDir?: string;
  /** Craft-owned root for seeded Sources. Also scopes Skills in tests/legacy callers. */
  agentRootDir?: string;
  /** Pi user Skills target. Defaults to ~/.pi/agent/skills. */
  skillsDir?: string;
}

export interface SeedBucketResult {
  imported: string[];
  skipped: string[];
  failed: string[];
}

export interface SeedDefaultAgentResourcesResult {
  skills: SeedBucketResult;
  sources: SeedBucketResult;
}

function emptyBucket(): SeedBucketResult {
  return { imported: [], skipped: [], failed: [] };
}

function listResourceDirs(rootPath: string): string[] {
  if (!existsSync(rootPath)) return [];

  try {
    return readdirSync(rootPath, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function copyMissingResourceDirs(
  sourceRoot: string,
  targetRoot: string,
  slugs: readonly string[] = listResourceDirs(sourceRoot),
): SeedBucketResult {
  const result = emptyBucket();
  if (slugs.length === 0) return result;

  try {
    mkdirSync(targetRoot, { recursive: true });
  } catch {
    result.failed.push(...slugs);
    return result;
  }

  for (const slug of slugs) {
    const sourcePath = join(sourceRoot, slug);
    const targetPath = join(targetRoot, slug);

    if (existsSync(targetPath)) {
      result.skipped.push(slug);
      continue;
    }

    try {
      if (!statSync(sourcePath).isDirectory()) continue;

      cpSync(sourcePath, targetPath, { recursive: true });
      result.imported.push(slug);
    } catch {
      result.failed.push(slug);
    }
  }

  return result;
}

function isLegacyCatalogConfig(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const config = value as Record<string, unknown>;
  const api = config.api as Record<string, unknown> | undefined;
  return config.id === 'builtin-storyflow-catalog'
    && config.slug === 'storyflow-catalog'
    && config.provider === 'storyflow'
    && config.type === 'api'
    && api?.baseUrl === 'https://storyflow-model.zjding.com'
    && api.authType === 'managed';
}

function migrateLegacyCatalog(sourceRoot: string, targetRoot: string): boolean {
  const bundledDir = join(sourceRoot, 'storyflow-catalog');
  const installedDir = join(targetRoot, 'storyflow-catalog');
  const installedConfigPath = join(installedDir, 'config.json');
  if (!existsSync(installedConfigPath)) return false;

  try {
    const installed = JSON.parse(readFileSync(installedConfigPath, 'utf8')) as unknown;
    if (!isLegacyCatalogConfig(installed)) return false;

    const current = installed as Record<string, unknown>;
    const bundled = JSON.parse(readFileSync(join(bundledDir, 'config.json'), 'utf8')) as Record<string, unknown>;
    const migrated = {
      ...bundled,
      createdAt: current.createdAt ?? bundled.createdAt,
      ...(current.name !== 'Storyflow Catalog' ? { name: current.name } : {}),
      ...(current.icon !== '🎬' ? { icon: current.icon } : {}),
      ...(current.tagline !== '红果、GoodShort、ReelShort 与 DataEye 的来源内榜单和媒资覆盖证据'
        ? { tagline: current.tagline }
        : {}),
    };
    for (const file of ['guide.md', 'permissions.json']) {
      cpSync(join(bundledDir, file), join(installedDir, file));
    }
    const pendingConfigPath = `${installedConfigPath}.migration-tmp`;
    writeFileSync(pendingConfigPath, `${JSON.stringify(migrated, null, 2)}\n`);
    renameSync(pendingConfigPath, installedConfigPath);
    return true;
  } catch {
    return false;
  }
}

export function seedDefaultAgentResources(
  options: SeedDefaultAgentResourcesOptions = {},
): SeedDefaultAgentResourcesResult {
  const assetsDir = options.assetsDir ?? getBundledAssetsDir('agent-defaults');
  const agentRootDir = options.agentRootDir ?? CRAFT_AGENT_ROOT_DIR;
  const skillsDir = options.skillsDir
    ?? (options.agentRootDir ? join(agentRootDir, 'skills') : getPiUserSkillsDir());

  if (!assetsDir || !existsSync(assetsDir)) {
    return {
      skills: emptyBucket(),
      sources: emptyBucket(),
    };
  }

  const sources = copyMissingResourceDirs(join(assetsDir, 'sources'), join(agentRootDir, 'sources'));
  if (migrateLegacyCatalog(join(assetsDir, 'sources'), join(agentRootDir, 'sources'))) {
    sources.skipped = sources.skipped.filter(slug => slug !== 'storyflow-catalog');
    sources.imported.push('storyflow-catalog');
    sources.imported.sort();
  }

  return {
    skills: copyMissingResourceDirs(
      join(assetsDir, 'global-skills'),
      skillsDir,
      DEFAULT_GLOBAL_AGENT_SKILL_SLUGS,
    ),
    sources,
  };
}
