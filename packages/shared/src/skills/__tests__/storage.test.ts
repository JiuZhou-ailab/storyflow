// input: Temporary project Skill trees, invalid documents, caches, and filesystem symlinks
// output: Regression coverage for project-only Pi Skill loading and safe deletion
// pos: Storage boundary test preventing legacy/global discovery and project-root escapes
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  loadAllSkills,
  loadWorkspaceSkills,
  loadSkill,
  invalidateSkillsCache,
  skillExists,
  listSkillSlugs,
  deleteSkill,
  isValidSkillSlug,
} from '../storage.ts';

// ============================================================
// Temp Directory Setup
// ============================================================

let tempDir: string;
let workspaceRoot: string;
const getSkillsDir = () => join(workspaceRoot, '.pi', 'skills');

// ============================================================
// Helpers
// ============================================================

/** Create a valid SKILL.md file in a skill directory */
function createSkill(
  skillsDir: string,
  slug: string,
  opts: { name?: string; description?: string; globs?: string[]; content?: string; icon?: string; requiredSources?: string[] } = {}
): string {
  const skillDir = join(skillsDir, slug);
  mkdirSync(skillDir, { recursive: true });

  const name = opts.name ?? slug.charAt(0).toUpperCase() + slug.slice(1);
  const description = opts.description ?? `A ${slug} skill`;
  const content = opts.content ?? `Instructions for ${slug}`;
  const globs = opts.globs ? `\nglobs:\n${opts.globs.map(g => `  - "${g}"`).join('\n')}` : '';
  const icon = opts.icon ? `\nicon: "${opts.icon}"` : '';
  const requiredSources = opts.requiredSources
    ? `\nrequiredSources:\n${opts.requiredSources.map(source => `  - "${source}"`).join('\n')}`
    : '';

  const skillMd = `---
name: "${name}"
description: "${description}"${globs}${icon}${requiredSources}
---

${content}
`;
  writeFileSync(join(skillDir, 'SKILL.md'), skillMd);
  return skillDir;
}

/** Create an invalid SKILL.md (missing required fields) */
function createInvalidSkill(skillsDir: string, slug: string): string {
  const skillDir = join(skillsDir, slug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), '---\ntitle: "No name or description"\n---\nContent');
  return skillDir;
}

/** Create a directory without SKILL.md */
function createEmptySkillDir(skillsDir: string, slug: string): string {
  const skillDir = join(skillsDir, slug);
  mkdirSync(skillDir, { recursive: true });
  return skillDir;
}

// ============================================================
// Test Setup
// ============================================================

beforeEach(() => {
  invalidateSkillsCache();
  tempDir = mkdtempSync(join(tmpdir(), 'skills-test-'));
  workspaceRoot = join(tempDir, 'workspace');
  mkdirSync(join(workspaceRoot, '.pi', 'skills'), { recursive: true });
});

afterEach(() => {
  invalidateSkillsCache();
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ============================================================
// Tests: loadSkill (single workspace skill)
// ============================================================

describe('loadSkill', () => {
  it('should load a valid skill from workspace', () => {
    const skillsDir = getSkillsDir();
    createSkill(skillsDir, 'commit', {
      name: 'Git Commit',
      description: 'Helps with git commits',
      content: 'Run git commit with a good message',
    });

    const skill = loadSkill(workspaceRoot, 'commit');

    expect(skill).not.toBeNull();
    expect(skill!.slug).toBe('commit');
    expect(skill!.metadata.name).toBe('Git Commit');
    expect(skill!.metadata.description).toBe('Helps with git commits');
    expect(skill!.content).toContain('Run git commit with a good message');
    expect(skill!.path).toBe(join(skillsDir, 'commit'));
  });

  it('should return null for non-existent skill slug', () => {
    const skill = loadSkill(workspaceRoot, 'nonexistent');
    expect(skill).toBeNull();
  });

  it('should return null for directory without SKILL.md', () => {
    createEmptySkillDir(getSkillsDir(), 'empty-skill');

    const skill = loadSkill(workspaceRoot, 'empty-skill');
    expect(skill).toBeNull();
  });

  it('should return null for invalid SKILL.md (missing required fields)', () => {
    createInvalidSkill(getSkillsDir(), 'bad-skill');

    const skill = loadSkill(workspaceRoot, 'bad-skill');
    expect(skill).toBeNull();
  });

  it('should load skill with optional globs', () => {
    createSkill(getSkillsDir(), 'frontend', {
      globs: ['*.tsx', '*.css'],
    });

    const skill = loadSkill(workspaceRoot, 'frontend');

    expect(skill).not.toBeNull();
    expect(skill!.metadata.globs).toEqual(['*.tsx', '*.css']);
  });

  it('should load skill with normalized requiredSources', () => {
    createSkill(getSkillsDir(), 'with-sources', {
      requiredSources: ['linear', ' github ', 'linear'],
    });

    const skill = loadSkill(workspaceRoot, 'with-sources');

    expect(skill).not.toBeNull();
    expect(skill!.metadata.requiredSources).toEqual(['linear', 'github']);
  });

  it('should normalize single-string requiredSources into an array', () => {
    const skillDir = join(getSkillsDir(), 'single-source');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), `---
name: "Single Source"
description: "Skill with scalar requiredSources"
requiredSources: linear
---

Use linear tools.
`);

    const skill = loadSkill(workspaceRoot, 'single-source');

    expect(skill).not.toBeNull();
    expect(skill!.metadata.requiredSources).toEqual(['linear']);
  });

  it('should ignore invalid requiredSources entries', () => {
    const skillDir = join(getSkillsDir(), 'invalid-sources');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), `---
name: "Invalid Sources"
description: "Skill with mixed requiredSources values"
requiredSources:
  - linear
  - 123
  - true
  - "  "
---

Use linear tools.
`);

    const skill = loadSkill(workspaceRoot, 'invalid-sources');

    expect(skill).not.toBeNull();
    expect(skill!.metadata.requiredSources).toEqual(['linear']);
  });

  it('should set iconPath when icon file exists', () => {
    const skillDir = createSkill(getSkillsDir(), 'with-icon');
    writeFileSync(join(skillDir, 'icon.svg'), '<svg></svg>');

    const skill = loadSkill(workspaceRoot, 'with-icon');

    expect(skill).not.toBeNull();
    expect(skill!.iconPath).toBe(join(skillDir, 'icon.svg'));
  });

  it('should not set iconPath when no icon file exists', () => {
    createSkill(getSkillsDir(), 'no-icon');

    const skill = loadSkill(workspaceRoot, 'no-icon');

    expect(skill).not.toBeNull();
    expect(skill!.iconPath).toBeUndefined();
  });

  it('does not follow a symlinked Skill directory outside the project', () => {
    const outsideSkills = join(tempDir, 'outside-skills');
    createSkill(outsideSkills, 'outside-skill');
    symlinkSync(
      join(outsideSkills, 'outside-skill'),
      join(getSkillsDir(), 'outside-skill'),
      'dir',
    );

    expect(loadSkill(workspaceRoot, 'outside-skill')).toBeNull();
  });
});

// ============================================================
// Tests: loadWorkspaceSkills (all skills from workspace)
// ============================================================

describe('loadWorkspaceSkills', () => {
  it('should load multiple skills from workspace', () => {
    const skillsDir = getSkillsDir();
    createSkill(skillsDir, 'commit');
    createSkill(skillsDir, 'review');
    createSkill(skillsDir, 'deploy');

    const skills = loadWorkspaceSkills(workspaceRoot);

    expect(skills).toHaveLength(3);
    const slugs = skills.map(s => s.slug).sort();
    expect(slugs).toEqual(['commit', 'deploy', 'review']);
  });

  it('should return empty array for empty skills directory', () => {
    // workspaceRoot/skills/ exists but has no subdirectories
    const skills = loadWorkspaceSkills(workspaceRoot);
    expect(skills).toEqual([]);
  });

  it('should return empty array for non-existent workspace root', () => {
    const skills = loadWorkspaceSkills(join(tempDir, 'nonexistent'));
    expect(skills).toEqual([]);
  });

  it('should skip directories without SKILL.md', () => {
    const skillsDir = getSkillsDir();
    createSkill(skillsDir, 'valid-skill');
    createEmptySkillDir(skillsDir, 'no-skill-md');

    const skills = loadWorkspaceSkills(workspaceRoot);

    expect(skills).toHaveLength(1);
    expect(skills[0]!.slug).toBe('valid-skill');
  });

  it('should skip invalid SKILL.md files', () => {
    const skillsDir = getSkillsDir();
    createSkill(skillsDir, 'valid');
    createInvalidSkill(skillsDir, 'invalid');

    const skills = loadWorkspaceSkills(workspaceRoot);

    expect(skills).toHaveLength(1);
    expect(skills[0]!.slug).toBe('valid');
  });

  it('should skip non-directory entries', () => {
    const skillsDir = getSkillsDir();
    createSkill(skillsDir, 'real-skill');
    // Create a plain file in the skills directory (not a subdirectory)
    writeFileSync(join(skillsDir, 'readme.txt'), 'This is not a skill');

    const skills = loadWorkspaceSkills(workspaceRoot);

    expect(skills).toHaveLength(1);
    expect(skills[0]!.slug).toBe('real-skill');
  });
});

// ============================================================
// Tests: loadAllSkills (single project scope)
// ============================================================

describe('loadAllSkills', () => {
  const TEST_PREFIX = 'test-storage-';

  it('loads only Skills from the current project', () => {
    createSkill(getSkillsDir(), `${TEST_PREFIX}project`, {
      name: 'Project Skill',
      description: 'From current project',
    });

    const skills = loadAllSkills(workspaceRoot);

    expect(skills.map(skill => skill.slug)).toEqual([`${TEST_PREFIX}project`]);
  });

  it('does not discover project or global .agents Skills', () => {
    createSkill(join(workspaceRoot, '.agents', 'skills'), `${TEST_PREFIX}agents`);
    createSkill(getSkillsDir(), `${TEST_PREFIX}pi`);

    const skills = loadAllSkills(workspaceRoot);

    expect(skills.find(skill => skill.slug === `${TEST_PREFIX}agents`)).toBeUndefined();
    expect(skills.find(skill => skill.slug === `${TEST_PREFIX}pi`)).toBeDefined();
  });

  it('returns an empty list for a project without Skills', () => {
    expect(loadAllSkills(join(tempDir, 'empty-project'))).toEqual([]);
  });
});

// ============================================================
// Tests: cache invalidation
// ============================================================

describe('skills cache invalidation', () => {
  it('reloads changed skill metadata after cache invalidation', () => {
    const skillsDir = getSkillsDir();
    createSkill(skillsDir, 'rename-me', {
      name: 'Original Name',
      description: 'Before rename',
    });

    const before = loadAllSkills(workspaceRoot).find(s => s.slug === 'rename-me');
    expect(before?.metadata.name).toBe('Original Name');

    createSkill(skillsDir, 'rename-me', {
      name: 'Renamed Skill',
      description: 'After rename',
    });

    const cached = loadAllSkills(workspaceRoot).find(s => s.slug === 'rename-me');
    expect(cached?.metadata.name).toBe('Original Name');

    invalidateSkillsCache();

    const after = loadAllSkills(workspaceRoot).find(s => s.slug === 'rename-me');
    expect(after?.metadata.name).toBe('Renamed Skill');
  });
});

// ============================================================
// Tests: skillExists
// ============================================================

describe('skillExists', () => {
  it('should return true for existing skill with SKILL.md', () => {
    createSkill(getSkillsDir(), 'exists-skill');
    expect(skillExists(workspaceRoot, 'exists-skill')).toBe(true);
  });

  it('should return false for non-existent skill', () => {
    expect(skillExists(workspaceRoot, 'ghost-skill')).toBe(false);
  });

  it('should return false for directory without SKILL.md', () => {
    createEmptySkillDir(getSkillsDir(), 'empty');
    expect(skillExists(workspaceRoot, 'empty')).toBe(false);
  });
});

// ============================================================
// Tests: listSkillSlugs
// ============================================================

describe('listSkillSlugs', () => {
  it('should list all valid skill slugs', () => {
    const skillsDir = getSkillsDir();
    createSkill(skillsDir, 'alpha');
    createSkill(skillsDir, 'beta');
    createEmptySkillDir(skillsDir, 'no-skill-md');

    const slugs = listSkillSlugs(workspaceRoot);
    expect(slugs.sort()).toEqual(['alpha', 'beta']);
  });

  it('should return empty array for empty skills directory', () => {
    const slugs = listSkillSlugs(workspaceRoot);
    expect(slugs).toEqual([]);
  });

  it('should return empty array for non-existent workspace', () => {
    const slugs = listSkillSlugs(join(tempDir, 'nonexistent'));
    expect(slugs).toEqual([]);
  });
});

// ============================================================
// Tests: deleteSkill
// ============================================================

describe('deleteSkill', () => {
  it('should delete an existing skill', () => {
    const skillsDir = join(workspaceRoot, '.pi', 'skills');
    createSkill(skillsDir, 'to-delete');
    expect(skillExists(workspaceRoot, 'to-delete')).toBe(true);

    const result = deleteSkill(workspaceRoot, 'to-delete');

    expect(result).toBe(true);
    expect(skillExists(workspaceRoot, 'to-delete')).toBe(false);
  });

  it('should return false for non-existent skill', () => {
    const result = deleteSkill(workspaceRoot, 'nonexistent');
    expect(result).toBe(false);
  });

  it('never deletes a Skill from a legacy project-local directory', () => {
    const legacyDir = join(workspaceRoot, '.agents', 'skills');
    createSkill(legacyDir, 'legacy-skill');

    expect(deleteSkill(workspaceRoot, 'legacy-skill')).toBe(false);
    expect(existsSync(join(legacyDir, 'legacy-skill', 'SKILL.md'))).toBe(true);
  });

  it('rejects deletion when .pi is a symlink outside the project', () => {
    const outsideRoot = join(tempDir, 'outside-project-data');
    const escapedSkill = createSkill(join(outsideRoot, 'skills'), 'escaped-skill');
    rmSync(join(workspaceRoot, '.pi'), { recursive: true });
    symlinkSync(outsideRoot, join(workspaceRoot, '.pi'), 'dir');

    expect(deleteSkill(workspaceRoot, 'escaped-skill')).toBe(false);
    expect(existsSync(join(escapedSkill, 'SKILL.md'))).toBe(true);
  });
});

describe('isValidSkillSlug', () => {
  it('accepts Agent Skills identifiers and rejects traversal input', () => {
    expect(isValidSkillSlug('outline-architecture')).toBe(true);
    expect(isValidSkillSlug('../outside')).toBe(false);
    expect(isValidSkillSlug('nested/skill')).toBe(false);
    expect(isValidSkillSlug('Uppercase')).toBe(false);
  });
});
