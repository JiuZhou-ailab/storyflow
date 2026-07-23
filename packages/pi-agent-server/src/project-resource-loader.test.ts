// input: Temporary Pi projects, explicit global resources, and escaping filesystem symlinks
// output: Assertions for project-over-global Skills and global-only Extensions
// pos: Security regression test for explicit Pi resource discovery and scope isolation

import { afterEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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

function writeExtension(
  root: string,
  relativeDir: string,
  name: string,
  toolName?: string,
): void {
  const extensionDir = join(root, relativeDir);
  mkdirSync(extensionDir, { recursive: true });
  const registration = toolName
    ? `pi.registerTool({
    name: '${toolName}',
    label: '${toolName}',
    description: 'Test tool',
    parameters: { type: 'object', properties: {} },
    async execute() {
      return { content: [{ type: 'text', text: 'ok' }], details: {} };
    },
  });`
    : '';
  writeFileSync(
    join(extensionDir, `${name}.ts`),
    `export default function extension(pi) { ${registration} }\n`,
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('createProjectResourceLoader', () => {
  it('loads explicit project/global Skills and only global Extensions', async () => {
    const projectRoot = createRoot();
    const globalRoot = createRoot();
    const agentDir = join(createRoot(), 'agent');
    writeSkill(projectRoot, '.pi/skills', 'project-skill');
    writeSkill(globalRoot, 'skills', 'global-skill');
    writeSkill(projectRoot, '.agents/skills', 'legacy-project-skill');
    writeSkill(agentDir, 'skills', 'agent-dir-skill');
    writeExtension(
      globalRoot,
      'extensions',
      'global-extension',
      'global-extension-tool',
    );
    writeExtension(projectRoot, '.pi/extensions', 'project-extension');

    const { resourceLoader } = await createProjectResourceLoader({
      cwd: projectRoot,
      projectRoot,
      globalRoot,
      agentDir,
    });

    expect(resourceLoader.getSkills().skills.map(skill => skill.name)).toEqual([
      'project-skill',
      'global-skill',
    ]);
    expect(resourceLoader.getExtensions().extensions).toHaveLength(1);
    expect(resourceLoader.getExtensions().extensions[0]?.resolvedPath)
      .toContain('global-extension.ts');
    expect(
      resourceLoader.getExtensions().extensions[0]?.tools.has('global-extension-tool'),
    ).toBe(true);
  });

  it('loads global resources without creating a project overlay', async () => {
    const cwd = createRoot();
    const globalRoot = createRoot();
    const agentDir = join(createRoot(), 'agent');
    writeSkill(globalRoot, 'skills', 'global-only');

    const { resourceLoader } = await createProjectResourceLoader({
      cwd,
      globalRoot,
      agentDir,
    });

    expect(resourceLoader.getSkills().skills.map(skill => skill.name)).toEqual([
      'global-only',
    ]);
    expect(existsSync(join(cwd, '.pi'))).toBe(false);
  });

  it('lets a project Skill override a global Skill with the same name', async () => {
    const projectRoot = createRoot();
    const globalRoot = createRoot();
    const agentDir = join(createRoot(), 'agent');
    writeSkill(projectRoot, '.pi/skills', 'shared-skill');
    writeSkill(globalRoot, 'skills', 'shared-skill');

    const { resourceLoader } = await createProjectResourceLoader({
      cwd: projectRoot,
      projectRoot,
      globalRoot,
      agentDir,
    });

    const skills = resourceLoader.getSkills();
    expect(skills.skills).toHaveLength(1);
    expect(skills.skills[0]?.filePath).toContain(projectRoot);
    expect(skills.diagnostics.some(diagnostic => diagnostic.type === 'collision')).toBe(true);
  });

  it('rejects a canonical Skills path whose .pi ancestor escapes through a symlink', async () => {
    const projectRoot = createRoot();
    const outsideRoot = createRoot();
    const globalRoot = createRoot();
    const agentDir = join(createRoot(), 'agent');
    symlinkSync(outsideRoot, join(projectRoot, '.pi'), 'dir');

    await expect(createProjectResourceLoader({
      cwd: projectRoot,
      projectRoot,
      globalRoot,
      agentDir,
    })).rejects.toThrow('symbolic link');
  });

  it('rejects a Skill tree containing a symlink before Pi can load it', async () => {
    const projectRoot = createRoot();
    const outsideRoot = createRoot();
    const globalRoot = createRoot();
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
      globalRoot,
      agentDir,
    })).rejects.toThrow('symbolic link');
  });

  it('revalidates the Skill tree on later reloads', async () => {
    const projectRoot = createRoot();
    const outsideRoot = createRoot();
    const globalRoot = createRoot();
    const agentDir = join(createRoot(), 'agent');
    writeSkill(projectRoot, '.pi/skills', 'safe-skill');
    writeSkill(outsideRoot, 'skills', 'outside-skill');

    const { resourceLoader } = await createProjectResourceLoader({
      cwd: projectRoot,
      projectRoot,
      globalRoot,
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
