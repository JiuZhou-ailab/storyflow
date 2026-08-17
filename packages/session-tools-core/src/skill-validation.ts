// input: Untrusted Agent Skill markdown and its directory slug
// output: Worker-safe Agent Skills validation with no filesystem dependency
// pos: Portable Skill document contract shared by runtimes and publication gates

import matter from 'gray-matter';
import { z } from 'zod';
import type { ValidationIssue, ValidationResult } from './types.ts';

const SKILL_NAME_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SKILL_NAME_LENGTH = 64;
const MAX_SKILL_DESCRIPTION_LENGTH = 1024;

function validResult(): ValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

function invalidResult(path: string, message: string, suggestion?: string): ValidationResult {
  return { valid: false, errors: [{ path, message, suggestion }], warnings: [] };
}

/** Validate an Agent Skills identifier before using it as a filesystem segment. */
export function validateSkillSlug(slug: string): ValidationResult {
  if (slug.length <= MAX_SKILL_NAME_LENGTH && SKILL_NAME_REGEX.test(slug)) {
    return validResult();
  }

  const suggestedSlug = slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, MAX_SKILL_NAME_LENGTH)
    .replace(/-+$/g, '');

  return invalidResult(
    'slug',
    `Skill slug must be lowercase alphanumeric with single hyphens and at most ${MAX_SKILL_NAME_LENGTH} characters`,
    `Suggested: '${suggestedSlug || 'valid-skill-name'}'`,
  );
}

export const SkillMetadataSchema = z.object({
  name: z.string()
    .min(1, "Add a 'name' field matching the Skill folder")
    .max(MAX_SKILL_NAME_LENGTH, `Skill name must be at most ${MAX_SKILL_NAME_LENGTH} characters`)
    .regex(SKILL_NAME_REGEX, 'Skill name must be lowercase letters, numbers, and single hyphens'),
  description: z.string()
    .min(1, "Add a 'description' field explaining what this skill does")
    .max(MAX_SKILL_DESCRIPTION_LENGTH, `Skill description must be at most ${MAX_SKILL_DESCRIPTION_LENGTH} characters`),
  metadata: z.object({
    displayName: z.string().min(1).optional(),
  }).passthrough().optional(),
  globs: z.array(z.string()).optional(),
  alwaysAllow: z.array(z.string()).optional(),
  icon: z.string().optional(),
  requiredSources: z.union([z.string(), z.array(z.unknown())]).optional(),
}).passthrough();

/** Validate SKILL.md content without filesystem access. */
export function validateSkillContent(markdownContent: string, slug: string): ValidationResult {
  const errors: ValidationIssue[] = [...validateSkillSlug(slug).errors];
  let frontmatter: unknown;
  let body: string;
  try {
    const parsed = matter(markdownContent);
    frontmatter = parsed.data;
    body = parsed.content;
  } catch (error) {
    return invalidResult(
      'frontmatter',
      `Invalid YAML frontmatter: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'Check YAML syntax in frontmatter section',
    );
  }

  const metadata = SkillMetadataSchema.safeParse(frontmatter);
  if (!metadata.success) {
    errors.push(...metadata.error.issues.map(issue => ({
      path: issue.path.join('.') || 'SKILL.md',
      message: issue.message,
    })));
  } else if (metadata.data.name !== slug) {
    errors.push({
      path: 'name',
      message: `Skill name '${metadata.data.name}' does not match its parent directory '${slug}'`,
      suggestion: `Set frontmatter name to '${slug}'`,
    });
  }

  if (!body || body.trim().length === 0) {
    errors.push({
      path: 'content',
      message: 'Skill content is empty (nothing after frontmatter)',
      suggestion: 'Add instructions after the frontmatter describing what the skill should do',
    });
  }

  return { valid: errors.length === 0, errors, warnings: [] };
}
