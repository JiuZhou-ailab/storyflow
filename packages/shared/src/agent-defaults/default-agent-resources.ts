// input: Bundled product Skills, default Sources, and optional resource-root overrides
// output: Best-effort Pi user Skill and Storyflow Source seeding; ownership-safe legacy Catalog migration
// pos: Resource bootstrap for the minimal Storyflow product defaults

import { createHash } from 'crypto';
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

// Fingerprints of product-shipped Catalog resources before the current default.
// Automatic migration is destructive, so a known release artifact is the
// ownership proof; any user-edited file makes the whole Source ineligible.
const LEGACY_CATALOG_CONFIG_SHA256 = new Set([
  'b5fdfeb8c8107d472aea146ad7a7c5044a0837ff5156e55a7ace60cd53229d07', // 039b25de7
  'd878eaf331b0850b9f9bd160e6185728da30286335a4e3f544ca49acb2bb54b1', // f8b1a3d6a
  'ee0d364d83a4fe779c8e943fc61a2eb89515c5cd81877d283fb057b65f2b9b3c', // dc9afc5f6
  'd66f80dab46e03d31e40d714ee6b07f5fc4d306d3646e4b36e491c7e08e0bea1', // 420c94425
  '8ce670767d49516d640373e1e095a26b8a8ef67104dfe7ea3cfc1cc54f18cce5', // 5308d6449
  '27538751e0657436430c92da96238cf5d32ede5631f134137447f48094abf1c3', // bffd0d487
]);

const LEGACY_CATALOG_GUIDE_SHA256 = new Set([
  'b54c6158071714e8f5ce4759fe1e218fe671625242325b798c531625deb4e5b5', // 039b25de7
  '9c421308eaad6108ef21cb16d242e71ceeb02c287cb258035e7e020a46a93aea', // f8b1a3d6a
  '69ede92d2d1cdcce1db2d502c076d7da7b68840042d3c374ee5cce7cfe29c9e7', // dc9afc5f6
  'ae28cc6c9e9cabd9dac7bba59baff94feea1a0af9b44fc3ee2ffd67f304918f1', // d6ad25e6f
  'd0fba47af73c11cc75e0d441e8a124dd6a5594793adf563a8bfea5dc8b45af4e', // 5308d6449
]);

const LEGACY_CATALOG_PERMISSIONS_SHA256 = new Set([
  '90a90745e70c2d1354737e19cc3fc6d28e6310609d1a86dfa72f552a2bee93f5', // 039b25de7
  'b6d5ae096b006a81bc44f8bfb7389b829139a10fc5a6231292280c9c38f9bd2f', // f8b1a3d6a
  '288b068ed434918ee4e083ab5e6ac1b08fb31fcad03e9cb132f9c4e79338da22', // d6ad25e6f
]);

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isProductOwnedLegacyCatalogConfig(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const config = value as Record<string, unknown>;
  if (typeof config.enabled !== 'boolean') return false;
  return LEGACY_CATALOG_CONFIG_SHA256.has(sha256(JSON.stringify({ ...config, enabled: true })));
}

function isProductOwnedFile(installedPath: string, bundledPath: string, knownHashes: Set<string>): boolean {
  const installed = readFileSync(installedPath, 'utf8');
  return installed === readFileSync(bundledPath, 'utf8') || knownHashes.has(sha256(installed));
}

function migrateLegacyCatalog(sourceRoot: string, targetRoot: string): boolean {
  const bundledDir = join(sourceRoot, 'storyflow-catalog');
  const installedDir = join(targetRoot, 'storyflow-catalog');
  const installedConfigPath = join(installedDir, 'config.json');
  if (!existsSync(installedConfigPath)) return false;

  try {
    const installed = JSON.parse(readFileSync(installedConfigPath, 'utf8')) as unknown;
    if (!isProductOwnedLegacyCatalogConfig(installed)) return false;

    const installedGuidePath = join(installedDir, 'guide.md');
    const installedPermissionsPath = join(installedDir, 'permissions.json');
    const bundledGuidePath = join(bundledDir, 'guide.md');
    const bundledPermissionsPath = join(bundledDir, 'permissions.json');
    if (!isProductOwnedFile(installedGuidePath, bundledGuidePath, LEGACY_CATALOG_GUIDE_SHA256)
      || !isProductOwnedFile(installedPermissionsPath, bundledPermissionsPath, LEGACY_CATALOG_PERMISSIONS_SHA256)) {
      return false;
    }

    const current = installed as Record<string, unknown>;
    const bundled = JSON.parse(readFileSync(join(bundledDir, 'config.json'), 'utf8')) as Record<string, unknown>;
    const migrated = {
      ...bundled,
      enabled: current.enabled ?? bundled.enabled,
    };
    cpSync(bundledGuidePath, installedGuidePath);
    cpSync(bundledPermissionsPath, installedPermissionsPath);
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
