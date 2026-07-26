// input: Bundled product Skills, default Sources, and explicit project Skill installation requests
// output: Best-effort global resource seeding plus an opt-in project Skill copy primitive
// pos: Resource bootstrap separating product-wide capabilities from project-owned methods

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'fs';
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { basename, dirname, join } from 'path';
import { getBundledAssetsDir } from '../utils/paths.ts';
import { isValidSkillSlug } from '../skills/storage.ts';
import {
  assertSymlinkFreeTree,
  ensureProjectOwnedDirectory,
  getWorkspaceSkillsPath,
  resolveProjectOwnedPath,
} from '../workspaces/paths.ts';

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

export const DEFAULT_GLOBAL_AGENT_SKILL_SLUGS = [
  'skill-creator',
] as const;

export const DEFAULT_AGENT_SOURCE_SLUGS = [
  'wangwen-bigdata',
] as const;

/** Craft app data root. Seeded product resources live under this tree only. */
export const CRAFT_AGENT_ROOT_DIR = join(homedir(), '.craft-agent');

export interface SeedDefaultAgentResourcesOptions {
  assetsDir?: string;
  /** Craft-owned root for seeded skills/sources. Defaults to ~/.craft-agent */
  agentRootDir?: string;
}

export interface SeedDefaultProjectSkillsOptions {
  assetsDir?: string;
  /** Slugs already handled by an earlier lifecycle version. */
  skipSlugs?: readonly string[];
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

function pathEntryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function copySkillTreeAtomically(sourcePath: string, targetPath: string): void {
  assertSymlinkFreeTree(sourcePath);
  const temporaryPath = join(
    dirname(targetPath),
    `.${basename(targetPath)}.storyflow-import-${randomUUID()}`,
  );

  try {
    cpSync(sourcePath, temporaryPath, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
    });
    assertSymlinkFreeTree(temporaryPath);
    renameSync(temporaryPath, targetPath);
  } finally {
    rmSync(temporaryPath, { recursive: true, force: true });
  }
}

export function seedDefaultAgentResources(
  options: SeedDefaultAgentResourcesOptions = {},
): SeedDefaultAgentResourcesResult {
  const assetsDir = options.assetsDir ?? getBundledAssetsDir('agent-defaults');
  const agentRootDir = options.agentRootDir ?? CRAFT_AGENT_ROOT_DIR;

  if (!assetsDir || !existsSync(assetsDir)) {
    return {
      skills: emptyBucket(),
      sources: emptyBucket(),
    };
  }

  return {
    skills: copyMissingResourceDirs(join(assetsDir, 'global-skills'), join(agentRootDir, 'skills')),
    sources: copyMissingResourceDirs(join(assetsDir, 'sources'), join(agentRootDir, 'sources')),
  };
}

/** Install bundled Skill templates into one Storyflow/Pi project. */
export function seedDefaultProjectSkills(
  projectRoot: string,
  options: SeedDefaultProjectSkillsOptions = {},
): SeedBucketResult {
  const assetsDir = options.assetsDir ?? getBundledAssetsDir('agent-defaults');
  if (!assetsDir || !existsSync(assetsDir)) return emptyBucket();

  const sourceRoot = join(assetsDir, 'skills');
  const skippedByState = new Set(options.skipSlugs ?? []);
  const slugs = listResourceDirs(sourceRoot)
    .filter(slug => isValidSkillSlug(slug) && !skippedByState.has(slug));
  const result = emptyBucket();
  if (slugs.length === 0) return result;

  let targetRoot: string;
  try {
    assertSymlinkFreeTree(sourceRoot);
    targetRoot = ensureProjectOwnedDirectory(projectRoot, getWorkspaceSkillsPath(projectRoot));
  } catch {
    result.failed.push(...slugs);
    return result;
  }

  for (const slug of slugs) {
    const sourcePath = join(sourceRoot, slug);
    const targetPath = join(targetRoot, slug);
    try {
      if (pathEntryExists(targetPath)) {
        const safeTargetPath = resolveProjectOwnedPath(projectRoot, targetPath);
        if (!lstatSync(safeTargetPath).isDirectory()) {
          throw new Error(`Skill target is not a directory: ${targetPath}`);
        }
        assertSymlinkFreeTree(safeTargetPath);
        result.skipped.push(slug);
        continue;
      }

      copySkillTreeAtomically(sourcePath, targetPath);
      result.imported.push(slug);
    } catch {
      result.failed.push(slug);
    }
  }

  return result;
}
