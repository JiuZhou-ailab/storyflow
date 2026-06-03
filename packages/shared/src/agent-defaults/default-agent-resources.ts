// input: Bundled agent-defaults assets and the user's ~/.agents directory
// output: First-run seeding for default skills and sources without overwriting user edits
// pos: Distribution resource bootstrap for globally visible agent resources

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

export const DEFAULT_AGENT_SKILL_SLUGS = [
  'character-design',
  'outline-architecture',
  'plot-causality-audit',
  'prose-drafting',
  'prose-revision',
  'story-ideation',
  'story-state-ledger',
  'storyflow-tutorial',
  'webnovel-short-diagnose',
] as const;

export const DEFAULT_AGENT_SOURCE_SLUGS = [
  'wangwen-bigdata',
] as const;

export interface SeedDefaultAgentResourcesOptions {
  assetsDir?: string;
  agentRootDir?: string;
}

export interface SeedBucketResult {
  imported: string[];
  skipped: string[];
}

export interface SeedDefaultAgentResourcesResult {
  skills: SeedBucketResult;
  sources: SeedBucketResult;
}

function emptyBucket(): SeedBucketResult {
  return { imported: [], skipped: [] };
}

function listResourceDirs(rootPath: string): string[] {
  if (!existsSync(rootPath)) return [];

  return readdirSync(rootPath, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

function copyMissingResourceDirs(sourceRoot: string, targetRoot: string): SeedBucketResult {
  const result = emptyBucket();
  const slugs = listResourceDirs(sourceRoot);
  if (slugs.length === 0) return result;

  mkdirSync(targetRoot, { recursive: true });

  for (const slug of slugs) {
    const sourcePath = join(sourceRoot, slug);
    const targetPath = join(targetRoot, slug);

    if (existsSync(targetPath)) {
      result.skipped.push(slug);
      continue;
    }

    if (!statSync(sourcePath).isDirectory()) continue;

    cpSync(sourcePath, targetPath, { recursive: true });
    result.imported.push(slug);
  }

  return result;
}

export function seedDefaultAgentResources(
  options: SeedDefaultAgentResourcesOptions = {},
): SeedDefaultAgentResourcesResult {
  const assetsDir = options.assetsDir ?? getBundledAssetsDir('agent-defaults');
  const agentRootDir = options.agentRootDir ?? join(homedir(), '.agents');

  if (!assetsDir || !existsSync(assetsDir)) {
    return {
      skills: emptyBucket(),
      sources: emptyBucket(),
    };
  }

  return {
    skills: copyMissingResourceDirs(join(assetsDir, 'skills'), join(agentRootDir, 'skills')),
    sources: copyMissingResourceDirs(join(assetsDir, 'sources'), join(agentRootDir, 'sources')),
  };
}
