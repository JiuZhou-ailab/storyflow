// input: Agent Skills frontmatter and resolved resource origin semantics
// output: Shared Skill metadata and loaded-definition types
// pos: Type contract used by storage, RPC, renderer, and Agent loaders

/**
 * Skills Types
 *
 * Type definitions for Storyflow project Skills executed by the Pi runtime.
 */

/**
 * Skill metadata from SKILL.md YAML frontmatter
 */
export interface SkillMetadata {
  /** Pi/Agent Skills machine identifier; matches the parent directory slug. */
  name: string;
  /** Optional localized or human-friendly label shown in Storyflow. */
  displayName?: string;
  /** Brief description shown in skill list */
  description: string;
  /** Optional file patterns that trigger this skill */
  globs?: string[];
  /** Optional tools to always allow when skill is active */
  alwaysAllow?: string[];
  /**
   * Optional icon - emoji or URL only.
   * - Emoji: rendered directly in UI (e.g., "🔧")
   * - URL: auto-downloaded to icon.{ext} file
   * Note: Relative paths and inline SVG are NOT supported.
   */
  icon?: string;
  /** Optional source slugs to auto-enable when this skill is invoked */
  requiredSources?: string[];
}

/**
 * A loaded skill with parsed content
 */
export type SkillDefinitionOrigin = 'project' | 'global';

export interface LoadedSkill {
  /** Directory name (slug) */
  slug: string;
  /** Parsed metadata from YAML frontmatter */
  metadata: SkillMetadata;
  /** Full SKILL.md content (without frontmatter) */
  content: string;
  /** Absolute path to icon file if exists */
  iconPath?: string;
  /** Absolute path to skill directory */
  path: string;
  /**
   * Filesystem owner of this Skill definition.
   *
   * Optional for protocol compatibility with older persisted/test fixtures;
   * current filesystem loaders always populate it.
   */
  origin?: SkillDefinitionOrigin;
}
