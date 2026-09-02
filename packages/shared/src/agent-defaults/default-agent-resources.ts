// input: Bundled product Skills, default Sources, and optional resource-root overrides
// output: Best-effort Pi user Skill and Storyflow Source seeding; legacy Catalog migration with a hidden per-Source backup
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

const OUTDATED_CATALOG_MCP_URLS = new Set([
  'http://172.16.33.66:8789/mcp',
  'http://172.16.33.103:8789/mcp',
  'http://120.27.207.223:7844/hot-drama/mcp',
  'https://script.duanju.com/hot-drama/mcp',
]);

const OUTDATED_CATALOG_TAGLINES = new Set([
  '红果、GoodShort、ReelShort 与 DataEye 的来源内榜单和媒资覆盖证据',
  '红果、GoodShort、ReelShort 与 DataEye 的榜单和媒资数据',
]);

function isOutdatedCatalogConfig(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const config = value as Record<string, unknown>;
  const api = config.api as Record<string, unknown> | undefined;
  const mcp = config.mcp as Record<string, unknown> | undefined;
  const isBundledCatalog = config.id === 'builtin-storyflow-catalog'
    && config.slug === 'storyflow-catalog'
    && config.provider === 'storyflow';
  if (!isBundledCatalog) return false;

  return (config.type === 'api'
      && api?.baseUrl === 'https://storyflow-model.zjding.com'
      && api.authType === 'managed')
    || (config.type === 'mcp'
      && mcp?.transport === 'http'
      && mcp.authType === 'none'
      && OUTDATED_CATALOG_MCP_URLS.has(String(mcp.url)));
}

function migrateLegacyCatalog(sourceRoot: string, targetRoot: string): boolean {
  const bundledDir = join(sourceRoot, 'storyflow-catalog');
  const installedDir = join(targetRoot, 'storyflow-catalog');
  const installedConfigPath = join(installedDir, 'config.json');
  if (!existsSync(installedConfigPath)) return false;

  try {
    const installed = JSON.parse(readFileSync(installedConfigPath, 'utf8')) as unknown;
    if (!isOutdatedCatalogConfig(installed)) return false;

    const current = installed as Record<string, unknown>;
    const bundled = JSON.parse(readFileSync(join(bundledDir, 'config.json'), 'utf8')) as Record<string, unknown>;
    // Only product-known outdated shapes reach this point (see isOutdatedCatalogConfig),
    // so config-level auth fields are product-shipped and intentionally dropped:
    // an old shared token must not be sent to the new endpoint.
    const migrated = {
      ...bundled,
      createdAt: current.createdAt ?? bundled.createdAt,
      enabled: current.enabled ?? bundled.enabled,
      ...(current.name !== 'Storyflow Catalog' ? { name: current.name } : {}),
      ...(current.icon !== '🎬' ? { icon: current.icon } : {}),
      ...(typeof current.tagline === 'string' && !OUTDATED_CATALOG_TAGLINES.has(current.tagline)
        ? { tagline: current.tagline }
        : {}),
    };
    // guide.md and permissions.json may carry user edits. Keep a copy before the
    // product version replaces them. Hidden so Source export never ships it.
    const backupDir = join(installedDir, '.migration-backup');
    for (const file of ['config.json', 'guide.md', 'permissions.json']) {
      const installedPath = join(installedDir, file);
      if (existsSync(installedPath)) backupFile(installedPath, backupDir, file);
    }
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

function backupFile(sourcePath: string, backupDir: string, fileName: string): void {
  try {
    mkdirSync(backupDir, { recursive: true });
    cpSync(sourcePath, join(backupDir, fileName), { force: true });
  } catch {
    // A failed backup must not abort the migration; the Source stays retryable.
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
