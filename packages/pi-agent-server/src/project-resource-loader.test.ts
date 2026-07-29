// input: Temporary Pi projects, native Skill roots, legacy resources, and filesystem symlinks
// output: Assertions for Pi-native Skills plus isolated Storyflow Extensions
// pos: Integration contract for Pi Skill discovery and Storyflow Extension isolation

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
  it('loads Pi project/user Skills and explicit Storyflow resources', async () => {
    const projectRoot = createRoot();
    const globalRoot = createRoot();
    const agentDir = join(createRoot(), 'agent');
    const userAgentDir = join(createRoot(), 'user-agent');
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
      globalRoot,
      agentDir,
      userAgentDir,
    });

    expect(resourceLoader.getSkills().skills.map(skill => skill.name)).toEqual(
      expect.arrayContaining([
        'project-skill',
        'global-skill',
        'legacy-project-skill',
        'agent-dir-skill',
      ]),
    );
    expect(resourceLoader.getExtensions().extensions).toHaveLength(1);
    expect(resourceLoader.getExtensions().extensions[0]?.resolvedPath)
      .toContain('global-extension.ts');
    expect(
      resourceLoader.getExtensions().extensions[0]?.tools.has('global-extension-tool'),
    ).toBe(true);
  });

  it('does not create a project overlay while loading legacy global Skills', async () => {
    const cwd = createRoot();
    const globalRoot = createRoot();
    const agentDir = join(createRoot(), 'agent');
    const userAgentDir = join(createRoot(), 'user-agent');
    writeSkill(globalRoot, 'skills', 'global-only');

    const { resourceLoader } = await createProjectResourceLoader({
      cwd,
      globalRoot,
      agentDir,
      userAgentDir,
    });

    expect(resourceLoader.getSkills().skills.map(skill => skill.name))
      .toContain('global-only');
    expect(existsSync(join(cwd, '.pi'))).toBe(false);
  });

  it('uses Pi collision precedence when project and user Skills share a name', async () => {
    const projectRoot = createRoot();
    const globalRoot = createRoot();
    const agentDir = join(createRoot(), 'agent');
    const userAgentDir = join(createRoot(), 'user-agent');
    writeSkill(projectRoot, '.pi/skills', 'shared-skill');
    writeSkill(globalRoot, 'skills', 'shared-skill');

    const { resourceLoader } = await createProjectResourceLoader({
      cwd: projectRoot,
      globalRoot,
      agentDir,
      userAgentDir,
    });

    const skills = resourceLoader.getSkills();
    expect(skills.skills.filter(skill => skill.name === 'shared-skill')).toHaveLength(1);
    expect(skills.diagnostics.some(diagnostic => (
      diagnostic.type === 'collision'
      && diagnostic.collision?.name === 'shared-skill'
    ))).toBe(true);
  });

  it('follows project Skill symlinks through Pi native discovery', async () => {
    const projectRoot = createRoot();
    const outsideRoot = createRoot();
    const globalRoot = createRoot();
    const agentDir = join(createRoot(), 'agent');
    const userAgentDir = join(createRoot(), 'user-agent');
    writeSkill(outsideRoot, 'skills', 'linked-project-skill');
    mkdirSync(join(projectRoot, '.pi'), { recursive: true });
    symlinkSync(join(outsideRoot, 'skills'), join(projectRoot, '.pi', 'skills'), 'dir');

    const { resourceLoader } = await createProjectResourceLoader({
      cwd: projectRoot,
      globalRoot,
      agentDir,
      userAgentDir,
    });

    expect(resourceLoader.getSkills().skills.map(skill => skill.name))
      .toContain('linked-project-skill');
  });

  it('deduplicates the same Skill reached through a compatibility symlink', async () => {
    const projectRoot = createRoot();
    const outsideRoot = createRoot();
    const globalRoot = createRoot();
    const agentDir = join(createRoot(), 'agent');
    const userAgentDir = join(createRoot(), 'user-agent');
    writeSkill(outsideRoot, 'skills', 'outside-skill');
    mkdirSync(join(globalRoot, 'skills'), { recursive: true });
    symlinkSync(
      join(outsideRoot, 'skills', 'outside-skill'),
      join(globalRoot, 'skills', 'escaped-skill'),
      'dir',
    );

    const { resourceLoader } = await createProjectResourceLoader({
      cwd: projectRoot,
      globalRoot,
      agentDir,
      userAgentDir,
    });

    expect(resourceLoader.getSkills().skills.filter(skill => skill.name === 'outside-skill'))
      .toHaveLength(1);
  });
});
