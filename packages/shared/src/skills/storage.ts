/**
 * Skills Storage
 *
 * input: Project roots, Skill slugs, and SKILL.md documents
 * output: Validated project-owned Pi Skill metadata, content, and storage operations
 * pos: Canonical Skill persistence at {project}/.pi/skills/{slug}/
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  lstatSync,
} from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import type { LoadedSkill, SkillMetadata } from './types.ts';
import {
  assertSymlinkFreeTree,
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
function loadSkillFromDir(skillsDir: string, slug: string): LoadedSkill | null {
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
  };
}

/**
 * Load all skills from a directory
 * @param skillsDir - Absolute path to skills directory
 * @param source - Where these skills are loaded from
 */
function loadSkillsFromDir(skillsDir: string): LoadedSkill[] {
  if (!existsSync(skillsDir)) {
    return [];
  }

  const skills: LoadedSkill[] = [];

  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skill = loadSkillFromDir(skillsDir, entry.name);
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
export function loadSkill(workspaceRoot: string, slug: string): LoadedSkill | null {
  if (!isValidSkillSlug(slug)) return null;
  try {
    const skillsDir = resolveProjectOwnedPath(workspaceRoot, getWorkspaceSkillsPath(workspaceRoot));
    resolveProjectOwnedPath(workspaceRoot, join(getWorkspaceSkillsPath(workspaceRoot), slug));
    return loadSkillFromDir(skillsDir, slug);
  } catch {
    return null;
  }
}

/**
 * Load all skills from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 */
export function loadWorkspaceSkills(workspaceRoot: string): LoadedSkill[] {
  try {
    const skillsDir = resolveProjectOwnedPath(workspaceRoot, getWorkspaceSkillsPath(workspaceRoot));
    return loadSkillsFromDir(skillsDir);
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
export function loadAllSkills(workspaceRoot: string): LoadedSkill[] {
  const cached = skillsCache.get(workspaceRoot);
  if (cached) return cached;

  const result = loadWorkspaceSkills(workspaceRoot);
  skillsCache.set(workspaceRoot, result);
  return result;
}

/**
 * Load a single project Skill by slug.
 * Unlike loadAllSkills(), this only reads the specific slug directory — O(1) not O(N).
 *
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill slug to load
 */
export function loadSkillBySlug(workspaceRoot: string, slug: string): LoadedSkill | null {
  return loadSkill(workspaceRoot, slug);
}

/**
 * Get icon path for a skill
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function getSkillIconPath(workspaceRoot: string, slug: string): string | null {
  const skillDir = loadSkill(workspaceRoot, slug)?.path;
  return skillDir ? findIconFile(skillDir) || null : null;
}

// ============================================================
// Delete Operations
// ============================================================

/**
 * Delete a skill from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function deleteSkill(workspaceRoot: string, slug: string): boolean {
  if (!isValidSkillSlug(slug)) return false;

  try {
    resolveProjectOwnedPath(workspaceRoot, getWorkspaceSkillsPath(workspaceRoot));
    const skillDir = resolveProjectOwnedPath(
      workspaceRoot,
      join(getWorkspaceSkillsPath(workspaceRoot), slug),
    );
    assertSymlinkFreeTree(skillDir);
    rmSync(skillDir, { recursive: true });
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
export function skillExists(workspaceRoot: string, slug: string): boolean {
  return !!loadSkill(workspaceRoot, slug);
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
