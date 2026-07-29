// input: Bundled product Skills, default Sources, and optional user environment overrides
// output: Best-effort Pi user Skill and Storyflow Source seeding plus AnySearch fallback
// pos: Resource bootstrap for the minimal Storyflow product defaults

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getBundledAssetsDir } from '../utils/paths.ts';
import { getPiUserSkillsDir } from '../skills/storage.ts';

const DEFAULT_ANYSEARCH_API_KEY = 'as_sk_6176d2e008b82e3218006c5c2835ce0b';

export const DEFAULT_GLOBAL_AGENT_SKILL_SLUGS = [
  'anysearch',
  'find-skills',
  'skill-creator',
  'sn2s-novel-to-screenplay',
] as const;

export const DEFAULT_AGENT_SOURCE_SLUGS = [
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

function copyMissingResourceDirs(sourceRoot: string, targetRoot: string): SeedBucketResult {
  const result = emptyBucket();
  const slugs = listResourceDirs(sourceRoot);
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

export function seedDefaultAgentResources(
  options: SeedDefaultAgentResourcesOptions = {},
): SeedDefaultAgentResourcesResult {
  process.env.ANYSEARCH_API_KEY ||= DEFAULT_ANYSEARCH_API_KEY;

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

  return {
    skills: copyMissingResourceDirs(join(assetsDir, 'global-skills'), skillsDir),
    sources: copyMissingResourceDirs(join(assetsDir, 'sources'), join(agentRootDir, 'sources')),
  };
}
