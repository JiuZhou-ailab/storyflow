// input: Temporary Pi projects, legacy/global-like Skills, and escaping filesystem symlinks
// output: Assertions that only a symlink-free current-project .pi/skills tree is loaded
// pos: Security regression test for Pi resource discovery and project-root isolation

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProjectResourceLoader } from './project-resource-loader.ts';

const roots: string[] = [];

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'storyflow-pi-resources-'));
  roots.push(root);
  return root;
}

function writeSkill(root: string, relativeDir: string, slug: string): void {
  const skillDir = join(root, relativeDir, slug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${slug}\ndescription: ${slug} description\n---\n\n# ${slug}\n`,
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('createProjectResourceLoader', () => {
  it('loads only the current project .pi/skills directory', async () => {
    const projectRoot = createRoot();
    const agentDir = join(createRoot(), 'agent');
    writeSkill(projectRoot, '.pi/skills', 'project-skill');
    writeSkill(projectRoot, '.agents/skills', 'legacy-project-skill');
    writeSkill(agentDir, 'skills', 'agent-dir-skill');

    const { resourceLoader } = await createProjectResourceLoader({
      cwd: projectRoot,
      projectRoot,
      agentDir,
    });

    expect(resourceLoader.getSkills().skills.map(skill => skill.name)).toEqual([
      'project-skill',
    ]);
  });

  it('does not report an error when a project has no Skills directory', async () => {
    const projectRoot = createRoot();
    const agentDir = join(createRoot(), 'agent');

    const { resourceLoader } = await createProjectResourceLoader({
      cwd: projectRoot,
      projectRoot,
      agentDir,
    });

    expect(resourceLoader.getSkills()).toEqual({ skills: [], diagnostics: [] });
  });

  it('rejects a canonical Skills path whose .pi ancestor escapes through a symlink', async () => {
    const projectRoot = createRoot();
    const outsideRoot = createRoot();
    const agentDir = join(createRoot(), 'agent');
    symlinkSync(outsideRoot, join(projectRoot, '.pi'), 'dir');

    await expect(createProjectResourceLoader({
      cwd: projectRoot,
      projectRoot,
      agentDir,
    })).rejects.toThrow('symbolic link');
  });

  it('rejects a Skill tree containing a symlink before Pi can load it', async () => {
    const projectRoot = createRoot();
    const outsideRoot = createRoot();
    const agentDir = join(createRoot(), 'agent');
    writeSkill(projectRoot, '.pi/skills', 'safe-skill');
    writeSkill(outsideRoot, 'skills', 'outside-skill');
    symlinkSync(
      join(outsideRoot, 'skills', 'outside-skill'),
      join(projectRoot, '.pi', 'skills', 'escaped-skill'),
      'dir',
    );

    await expect(createProjectResourceLoader({
      cwd: projectRoot,
      projectRoot,
      agentDir,
    })).rejects.toThrow('symbolic link');
  });

  it('revalidates the Skill tree on later reloads', async () => {
    const projectRoot = createRoot();
    const outsideRoot = createRoot();
    const agentDir = join(createRoot(), 'agent');
    writeSkill(projectRoot, '.pi/skills', 'safe-skill');
    writeSkill(outsideRoot, 'skills', 'outside-skill');

    const { resourceLoader } = await createProjectResourceLoader({
      cwd: projectRoot,
      projectRoot,
      agentDir,
    });
    symlinkSync(
      join(outsideRoot, 'skills', 'outside-skill'),
      join(projectRoot, '.pi', 'skills', 'escaped-after-start'),
      'dir',
    );

    await expect(resourceLoader.reload()).rejects.toThrow('symbolic link');
    expect(resourceLoader.getSkills().skills.map(skill => skill.name)).toEqual([
      'safe-skill',
    ]);
  });
});
