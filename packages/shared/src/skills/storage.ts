/**
 * Skills Storage
 *
 * input: Optional project roots, global/project Skill directories, and SKILL.md documents
 * output: Project-over-global Skill discovery plus project-owned mutation operations
 * pos: Shared Skill overlay storage with explicit Storyflow-owned resource roots
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  lstatSync,
  mkdirSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import type {
  LoadedSkill,
  SkillDefinitionOrigin,
  SkillMetadata,
} from './types.ts';
import { resolveResourceRoots } from '../resources/resolver.ts';
import {
  assertSymlinkFreeTree,
  ensureProjectOwnedDirectory,
  getWorkspaceSkillsPath,
  resolveProjectOwnedPath,
} from '../workspaces/paths.ts';
import {
  validateIconValue,
  findIconFile,
  downloadIcon,
  needsIconDownload,
  isIconUrl,
} from '../utils/icon.ts';

/**
 * Normalize requiredSources frontmatter to a clean string array.
 * Accepts a single string or array of strings, trims whitespace, and deduplicates.
 */
function normalizeRequiredSources(value: unknown): string[] | undefined {
  const asArray = typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value
      : undefined;

  if (!asArray) return undefined;

  const normalized = Array.from(new Set(
    asArray
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => entry.trim())
      .filter(Boolean)
  ));

  return normalized.length > 0 ? normalized : undefined;
}

// ============================================================
// Parsing
// ============================================================

/**
 * Parse SKILL.md content and extract frontmatter + body
 */
export function parseSkillFile(content: string): { metadata: SkillMetadata; body: string } | null {
  try {
    const parsed = matter(content);

    // Validate required fields
    if (!parsed.data.name || !parsed.data.description) {
      return null;
    }

    // Validate and extract optional icon field
    // Only accepts emoji or URL - rejects inline SVG and relative paths
    const icon = validateIconValue(parsed.data.icon, 'Skills');

    return {
      metadata: {
        name: parsed.data.name as string,
        displayName: typeof parsed.data.metadata?.displayName === 'string'
          ? parsed.data.metadata.displayName
          : undefined,
        description: parsed.data.description as string,
        globs: parsed.data.globs as string[] | undefined,
        alwaysAllow: parsed.data.alwaysAllow as string[] | undefined,
        icon,
        requiredSources: normalizeRequiredSources(parsed.data.requiredSources),
      },
      body: parsed.content,
    };
  } catch {
    return null;
  }
}

/** Validate that a portable SKILL.md belongs to the directory slug that will contain it. */
export function validateSkillDocumentForSlug(content: string, slug: string): string | null {
  if (!isValidSkillSlug(slug)) return 'Invalid Skill slug'
  const parsed = parseSkillFile(content)
  if (!parsed) return 'SKILL.md must contain valid name and description frontmatter'
  if (parsed.metadata.name !== slug) {
    return `SKILL.md name '${parsed.metadata.name}' does not match directory slug '${slug}'`
  }
  if (!parsed.body.trim()) return 'SKILL.md body must not be empty'
  return null
}

// ============================================================
// Load Operations
// ============================================================

/**
 * Load a single skill from a directory
 * @param skillsDir - Absolute path to skills directory
 * @param slug - Skill directory name
 * @param source - Where this skill is loaded from
 */
function loadSkillFromDir(
  skillsDir: string,
  slug: string,
  origin: SkillDefinitionOrigin,
): LoadedSkill | null {
  if (!isValidSkillSlug(slug)) return null;

  const skillDir = join(skillsDir, slug);
  const skillFile = join(skillDir, 'SKILL.md');

  // Check directory exists
  if (!existsSync(skillDir) || !lstatSync(skillDir).isDirectory()) {
    return null;
  }

  try {
    assertSymlinkFreeTree(skillDir);
  } catch {
    return null;
  }

  // Check SKILL.md exists
  if (!existsSync(skillFile)) {
    return null;
  }

  // Read and parse SKILL.md
  let content: string;
  try {
    content = readFileSync(skillFile, 'utf-8');
  } catch {
    return null;
  }

  const parsed = parseSkillFile(content);
  if (!parsed) {
    return null;
  }

  return {
    slug,
    metadata: parsed.metadata,
    content: parsed.body,
    iconPath: findIconFile(skillDir),
    path: skillDir,
    origin,
  };
}

/**
 * Load all skills from a directory
 * @param skillsDir - Absolute path to skills directory
 * @param source - Where these skills are loaded from
 */
function loadSkillsFromDir(
  skillsDir: string,
  origin: SkillDefinitionOrigin,
): LoadedSkill[] {
  if (!existsSync(skillsDir)) {
    return [];
  }

  const skills: LoadedSkill[] = [];

  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skill = loadSkillFromDir(skillsDir, entry.name, origin);
      if (skill) {
        skills.push(skill);
      }
    }
  } catch {
    // Ignore errors reading skills directory
  }

  return skills;
}

/**
 * Load a single skill from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function loadSkill(
  projectRoot: string | undefined,
  slug: string,
): LoadedSkill | null {
  if (!isValidSkillSlug(slug)) return null;

  for (const root of resolveResourceRoots({ projectRoot }).skills) {
    if (root.origin === 'project') {
      try {
        const skillsDir = resolveProjectOwnedPath(root.rootPath, root.path);
        resolveProjectOwnedPath(root.rootPath, join(root.path, slug));
        const skill = loadSkillFromDir(skillsDir, slug, root.origin);
        if (skill) return skill;
      } catch {
        continue;
      }
    } else {
      const skill = loadSkillFromDir(root.path, slug, root.origin);
      if (skill) return skill;
    }
  }

  return null;
}

/**
 * Load all skills from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 */
export function loadWorkspaceSkills(workspaceRoot: string): LoadedSkill[] {
  try {
    const skillsDir = resolveProjectOwnedPath(workspaceRoot, getWorkspaceSkillsPath(workspaceRoot));
    return loadSkillsFromDir(skillsDir, 'project');
  } catch {
    return [];
  }
}

// ── Skills cache ────────────────────────────────────────────────────────
// The result rarely changes during a session and is invalidated by the project watcher.

const skillsCache = new Map<string, LoadedSkill[]>();

/** Invalidate the skills cache (call on working dir change or skill file events). */
export function invalidateSkillsCache(): void {
  skillsCache.clear();
}

/**
 * Load all Skills owned by this Storyflow project.
 *
 * Results are cached per Storyflow project. Call invalidateSkillsCache() on
 * project Skill file events.
 *
 * @param workspaceRoot - Absolute path to workspace root
 */
export function loadAllSkills(projectRoot?: string): LoadedSkill[] {
  const cacheKey = projectRoot ?? '<global>';
  const cached = skillsCache.get(cacheKey);
  if (cached) return cached;

  const skillsBySlug = new Map<string, LoadedSkill>();
  for (const root of resolveResourceRoots({ projectRoot }).skills) {
    const skills = root.origin === 'project'
      ? loadWorkspaceSkills(root.rootPath)
      : loadSkillsFromDir(root.path, root.origin);
    for (const skill of skills) {
      if (!skillsBySlug.has(skill.slug)) {
        skillsBySlug.set(skill.slug, skill);
      }
    }
  }

  const result = Array.from(skillsBySlug.values());
  skillsCache.set(cacheKey, result);
  return result;
}

/**
 * Get icon path for a skill
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function getSkillIconPath(
  projectRoot: string | undefined,
  slug: string,
): string | null {
  const skillDir = loadSkill(projectRoot, slug)?.path;
  return skillDir ? findIconFile(skillDir) || null : null;
}

// ============================================================
// Mutation Operations
// ============================================================

/**
 * Create a Skill in the active owner layer.
 *
 * Free Conversations write to the global root. Project Conversations write to
 * that project's overlay. Existing definitions are never overwritten.
 */
export function createSkill(
  projectRoot: string | undefined,
  slug: string,
  content: string,
): LoadedSkill {
  const validationError = validateSkillDocumentForSlug(content, slug);
  if (validationError) throw new Error(validationError);

  const target = resolveResourceRoots({ projectRoot }).skills[0];
  if (!target) throw new Error('Skill root is unavailable');

  const targetDirectory = target.origin === 'project'
    ? ensureProjectOwnedDirectory(target.rootPath, target.path)
    : target.path;
  if (target.origin === 'global') {
    mkdirSync(targetDirectory, { recursive: true });
    assertSymlinkFreeTree(targetDirectory);
  }

  const skillDir = join(targetDirectory, slug);
  if (existsSync(skillDir)) throw new Error(`Skill already exists: ${slug}`);

  mkdirSync(skillDir);
  writeFileSync(join(skillDir, 'SKILL.md'), content, { encoding: 'utf-8', flag: 'wx' });
  invalidateSkillsCache();

  const skill = loadSkill(projectRoot, slug);
  if (!skill) throw new Error(`Failed to load created Skill: ${slug}`);
  return skill;
}

/**
 * Delete the visible Skill definition.
 * @param projectRoot - Optional project overlay root
 * @param slug - Skill directory name
 */
export function deleteSkill(projectRoot: string | undefined, slug: string): boolean {
  if (!isValidSkillSlug(slug)) return false;

  const skill = loadSkill(projectRoot, slug);
  if (!skill) return false;

  try {
    if (skill.origin === 'project' && projectRoot) {
      resolveProjectOwnedPath(projectRoot, getWorkspaceSkillsPath(projectRoot));
      resolveProjectOwnedPath(projectRoot, skill.path);
    } else {
      const globalSkillsRoot = resolveResourceRoots().skills[0]?.path;
      if (!globalSkillsRoot || skill.path !== join(globalSkillsRoot, slug)) return false;
    }
    assertSymlinkFreeTree(skill.path);
    rmSync(skill.path, { recursive: true });
    invalidateSkillsCache();
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Check if a skill exists in a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function skillExists(projectRoot: string | undefined, slug: string): boolean {
  return !!loadSkill(projectRoot, slug);
}

/** Agent Skills-compatible slug guard used before joining untrusted input. */
export function isValidSkillSlug(slug: string): boolean {
  return slug.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

/**
 * List skill slugs in a workspace
 * @param workspaceRoot - Absolute path to workspace root
 */
export function listSkillSlugs(workspaceRoot: string): string[] {
  return loadWorkspaceSkills(workspaceRoot).map((skill) => skill.slug);
}

// ============================================================
// Icon Download (uses shared utilities)
// ============================================================

/**
 * Download an icon from a URL and save it to the skill directory.
 * Returns the path to the downloaded icon, or null on failure.
 */
export async function downloadSkillIcon(
  skillDir: string,
  iconUrl: string
): Promise<string | null> {
  return downloadIcon(skillDir, iconUrl, 'Skills');
}

/**
 * Check if a skill needs its icon downloaded.
 * Returns true if metadata has a URL icon and no local icon file exists.
 */
export function skillNeedsIconDownload(skill: LoadedSkill): boolean {
  return needsIconDownload(skill.metadata.icon, skill.iconPath);
}

// Re-export icon utilities for convenience
export { isIconUrl } from '../utils/icon.ts';
