// input: Agent Skills frontmatter and Pi-native resource ownership semantics
// output: Shared Skill metadata, loaded definitions, and catalog diagnostics
// pos: Type contract used by storage, RPC, renderer, and Agent loaders

import type { ResourceDiagnostic } from '@earendil-works/pi-coding-agent';

export type SkillScope = 'user' | 'project' | 'temporary';
export type SkillOrigin = 'package' | 'top-level';

/**
 * Skills Types
 *
 * Type definitions for Storyflow Skills executed by the Pi runtime.
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

export interface LoadedSkill {
  /** Pi Skill machine name. */
  slug: string;
  /** Parsed metadata from YAML frontmatter */
  metadata: SkillMetadata;
  /** Full SKILL.md content (without frontmatter) */
  content: string;
  /** Absolute path to icon file if exists */
  iconPath?: string;
  /** Absolute path to skill directory */
  path: string;
  /** Absolute path to the loaded Markdown definition. */
  filePath: string;
  /** Pi-native ownership scope. */
  scope: SkillScope;
  /** Pi-native source label. */
  source: string;
  /** Whether Pi found the Skill directly or through a package. */
  origin: SkillOrigin;
}

export interface SkillCatalog {
  skills: LoadedSkill[];
  diagnostics: ResourceDiagnostic[];
}
