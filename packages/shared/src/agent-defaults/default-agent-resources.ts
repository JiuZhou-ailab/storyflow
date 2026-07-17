// input: Bundled defaults, legacy project Skills, lifecycle state, and project filesystem paths
// output: One-shot project Skill upgrades plus best-effort global Source seeding
// pos: Versioned bootstrap preserving user deletions and project filesystem boundaries

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { basename, dirname, join } from 'path';
import { getBundledAssetsDir } from '../utils/paths.ts';
import { isValidSkillSlug } from '../skills/storage.ts';
import {
  assertSymlinkFreeTree,
  ensureProjectOwnedDirectory,
  getLegacyCraftWorkspaceSkillsPath,
  getLegacyWorkspaceSkillsPath,
  getProjectSkillsLifecycleStatePath,
  getWorkspaceSkillsPath,
  resolveProjectOwnedPath,
  UnsafeProjectPathError,
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

const PROJECT_SKILLS_STATE_SCHEMA_VERSION = 1;
// Bump only when a new compatibility scan or bundled-default release should run.
const LEGACY_PROJECT_SKILLS_MIGRATION_VERSION = 1;
const BUNDLED_PROJECT_SKILLS_VERSION = 1;

interface ProjectSkillsLifecycleState {
  schemaVersion: typeof PROJECT_SKILLS_STATE_SCHEMA_VERSION;
  legacyMigrationVersion: number;
  bundledDefaultsVersion: number;
  legacySkillSlugs: string[];
  bundledSkillSlugs: string[];
}

export interface ProjectSkillsLifecycleOptions {
  assetsDir?: string;
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

function emptyProjectSkillsState(): ProjectSkillsLifecycleState {
  return {
    schemaVersion: PROJECT_SKILLS_STATE_SCHEMA_VERSION,
    legacyMigrationVersion: 0,
    bundledDefaultsVersion: 0,
    legacySkillSlugs: [],
    bundledSkillSlugs: [],
  };
}

function parsePersistedSlugs(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.some(slug => typeof slug !== 'string' || !isValidSkillSlug(slug))) {
    throw new Error(`Invalid ${fieldName} in project Skills lifecycle state`);
  }
  return Array.from(new Set(value)).sort();
}

function readProjectSkillsState(projectRoot: string): ProjectSkillsLifecycleState {
  const statePath = getProjectSkillsLifecycleStatePath(projectRoot);
  if (!pathEntryExists(statePath)) return emptyProjectSkillsState();

  const safeStatePath = resolveProjectOwnedPath(projectRoot, statePath);
  const parsed = JSON.parse(readFileSync(safeStatePath, 'utf-8')) as Partial<ProjectSkillsLifecycleState>;
  if (
    parsed.schemaVersion !== PROJECT_SKILLS_STATE_SCHEMA_VERSION
    || !Number.isInteger(parsed.legacyMigrationVersion)
    || (parsed.legacyMigrationVersion ?? -1) < 0
    || !Number.isInteger(parsed.bundledDefaultsVersion)
    || (parsed.bundledDefaultsVersion ?? -1) < 0
  ) {
    throw new Error('Unsupported project Skills lifecycle state');
  }

  return {
    schemaVersion: PROJECT_SKILLS_STATE_SCHEMA_VERSION,
    legacyMigrationVersion: parsed.legacyMigrationVersion!,
    bundledDefaultsVersion: parsed.bundledDefaultsVersion!,
    legacySkillSlugs: parsePersistedSlugs(parsed.legacySkillSlugs, 'legacySkillSlugs'),
    bundledSkillSlugs: parsePersistedSlugs(parsed.bundledSkillSlugs, 'bundledSkillSlugs'),
  };
}

function writeProjectSkillsState(projectRoot: string, state: ProjectSkillsLifecycleState): void {
  const statePath = getProjectSkillsLifecycleStatePath(projectRoot);
  const stateDir = ensureProjectOwnedDirectory(projectRoot, dirname(statePath));
  const safeStatePath = join(stateDir, basename(statePath));
  if (pathEntryExists(safeStatePath)) resolveProjectOwnedPath(projectRoot, statePath);

  const temporaryPath = join(stateDir, `.project-skills-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' });
    renameSync(temporaryPath, safeStatePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function warnProjectSkillFailure(message: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[project-skills] ${message}: ${detail}`);
}

function migrateLegacyProjectSkillsOnce(
  projectRoot: string,
  state: ProjectSkillsLifecycleState,
): boolean {
  let targetRoot: string;
  try {
    targetRoot = ensureProjectOwnedDirectory(projectRoot, getWorkspaceSkillsPath(projectRoot));
  } catch (error) {
    warnProjectSkillFailure('Refused unsafe canonical Skills directory', error);
    return false;
  }

  const processedSlugs = new Set(state.legacySkillSlugs);
  let complete = true;
  const legacyRoots = [
    getLegacyCraftWorkspaceSkillsPath(projectRoot),
    getLegacyWorkspaceSkillsPath(projectRoot),
    join(projectRoot, '.agents', 'skills'),
  ];

  for (const legacyRoot of legacyRoots) {
    if (!pathEntryExists(legacyRoot)) continue;

    let safeLegacyRoot: string;
    try {
      safeLegacyRoot = resolveProjectOwnedPath(projectRoot, legacyRoot);
    } catch (error) {
      if (!(error instanceof UnsafeProjectPathError)) complete = false;
      warnProjectSkillFailure('Skipped unsafe legacy Skills root', error);
      continue;
    }

    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = readdirSync(safeLegacyRoot, { withFileTypes: true });
    } catch (error) {
      complete = false;
      warnProjectSkillFailure('Could not scan legacy Skills root', error);
      continue;
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const slug = entry.name;
      if (!entry.isDirectory() || !isValidSkillSlug(slug) || processedSlugs.has(slug)) continue;

      const sourcePath = join(safeLegacyRoot, slug);
      const targetPath = join(targetRoot, slug);
      try {
        if (pathEntryExists(targetPath)) {
          const safeTargetPath = resolveProjectOwnedPath(projectRoot, targetPath);
          assertSymlinkFreeTree(safeTargetPath);
        } else {
          copySkillTreeAtomically(sourcePath, targetPath);
        }
        processedSlugs.add(slug);
      } catch (error) {
        if (error instanceof UnsafeProjectPathError) {
          // Unsafe trees are intentionally rejected and must not be retried later.
          processedSlugs.add(slug);
        } else {
          complete = false;
        }
        warnProjectSkillFailure(`Could not migrate legacy Skill '${slug}'`, error);
      }
    }
  }

  state.legacySkillSlugs = Array.from(processedSlugs).sort();
  return complete;
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
    // Skills are installed per project by seedDefaultProjectSkills().
    skills: emptyBucket(),
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

/**
 * Apply the project Skill compatibility transition exactly once per version.
 * Per-slug history preserves user deletions while allowing failed copies to retry.
 */
export function ensureProjectSkillsLifecycle(
  projectRoot: string,
  options: ProjectSkillsLifecycleOptions = {},
): void {
  let state: ProjectSkillsLifecycleState;
  try {
    state = readProjectSkillsState(projectRoot);
  } catch (error) {
    warnProjectSkillFailure('Refused invalid lifecycle state', error);
    return;
  }

  const originalState = JSON.stringify(state);
  if (state.legacyMigrationVersion < LEGACY_PROJECT_SKILLS_MIGRATION_VERSION) {
    if (migrateLegacyProjectSkillsOnce(projectRoot, state)) {
      state.legacyMigrationVersion = LEGACY_PROJECT_SKILLS_MIGRATION_VERSION;
    }
  }

  if (state.bundledDefaultsVersion < BUNDLED_PROJECT_SKILLS_VERSION) {
    const assetsDir = options.assetsDir ?? getBundledAssetsDir('agent-defaults');
    const bundledSkillsRoot = assetsDir ? join(assetsDir, 'skills') : undefined;
    if (assetsDir && bundledSkillsRoot && existsSync(bundledSkillsRoot)) {
      try {
        assertSymlinkFreeTree(bundledSkillsRoot);
        const result = seedDefaultProjectSkills(projectRoot, {
          assetsDir,
          skipSlugs: state.bundledSkillSlugs,
        });
        state.bundledSkillSlugs = Array.from(new Set([
          ...state.bundledSkillSlugs,
          ...result.imported,
          ...result.skipped,
        ])).sort();
        if (result.failed.length === 0) {
          state.bundledDefaultsVersion = BUNDLED_PROJECT_SKILLS_VERSION;
        }
      } catch (error) {
        warnProjectSkillFailure('Could not seed bundled project Skills', error);
      }
    }
  }

  if (JSON.stringify(state) === originalState) return;
  try {
    writeProjectSkillsState(projectRoot, state);
  } catch (error) {
    warnProjectSkillFailure('Could not persist lifecycle state', error);
  }
}
