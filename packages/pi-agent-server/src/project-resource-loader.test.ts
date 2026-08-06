// input: Temporary Pi projects, native resource roots, bundled runtime environment, legacy resources, and filesystem symlinks
// output: Assertions for Pi-native discovery plus Storyflow compatibility resources
// pos: Integration contract proving Pi remains the runtime resource authority

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createProjectResourceLoader,
  DEFAULT_PI_PACKAGE_SOURCES,
} from './project-resource-loader.ts';

const roots: string[] = [];
const previousPiOffline = process.env.PI_OFFLINE;
const previousCraftBun = process.env.CRAFT_BUN;

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

function writePackageSkill(packageRoot: string, slug: string): void {
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, 'package.json'),
    JSON.stringify({
      name: slug,
      version: '1.0.0',
      pi: { skills: ['./skill'] },
    }),
  );
  writeSkill(packageRoot, 'skill', slug);
}

function runSkillCatalog(
  cwd: string,
  home: string,
  globalRoot: string,
): { skills: Array<{ name: string }> } {
  const result = spawnSync(
    process.execPath,
    [join(import.meta.dir, 'index.ts'), '--skill-catalog', cwd],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        CRAFT_CONFIG_DIR: globalRoot,
        PI_OFFLINE: '1',
      },
    },
  );
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1) || '') as {
    skills: Array<{ name: string }>;
  };
}

beforeEach(() => {
  process.env.PI_OFFLINE = '1';
});

afterEach(() => {
  if (previousPiOffline === undefined) delete process.env.PI_OFFLINE;
  else process.env.PI_OFFLINE = previousPiOffline;
  if (previousCraftBun === undefined) delete process.env.CRAFT_BUN;
  else process.env.CRAFT_BUN = previousCraftBun;
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('createProjectResourceLoader', () => {
  it('does not execute legacy Storyflow Extensions', async () => {
    const cwd = createRoot();
    const home = createRoot();
    const globalRoot = createRoot();
    const markerPath = join(createRoot(), 'extension-executed');
    const extensionDir = join(globalRoot, 'extensions');
    mkdirSync(extensionDir, { recursive: true });
    writeFileSync(
      join(extensionDir, 'side-effect.ts'),
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(markerPath)}, 'executed');\nexport default function extension() {}\n`,
    );

    runSkillCatalog(cwd, home, globalRoot);

    expect(existsSync(markerPath)).toBe(false);

    await createProjectResourceLoader({
      cwd,
      globalRoot,
      agentDir: join(home, '.pi', 'agent'),
    });
    expect(existsSync(markerPath)).toBe(false);
  });

  it('uses Pi file-backed settings with explicit project trust boundaries', async () => {
    const cwd = createRoot();
    const home = createRoot();
    const globalRoot = createRoot();
    const agentDir = join(home, '.pi', 'agent');
    const projectPiDir = join(cwd, '.pi');

    writePackageSkill(join(agentDir, 'user-package'), 'user-package-skill');
    writeFileSync(
      join(agentDir, 'settings.json'),
      JSON.stringify({ packages: ['./user-package'] }),
    );
    writePackageSkill(join(projectPiDir, 'project-package'), 'project-package-skill');
    writeSkill(projectPiDir, 'skills', 'disabled-skill');
    writeFileSync(
      join(projectPiDir, 'settings.json'),
      JSON.stringify({
        packages: ['./project-package'],
        skills: ['-skills/disabled-skill'],
      }),
    );

    const catalog = runSkillCatalog(cwd, home, globalRoot);
    const names = catalog.skills.map(skill => skill.name);

    expect(names).toContain('user-package-skill');
    expect(names).toContain('project-package-skill');
    expect(names).not.toContain('disabled-skill');

    const { resourceLoader } = await createProjectResourceLoader({
      cwd,
      globalRoot,
      agentDir,
    });
    const runtimeNames = resourceLoader.getSkills().skills.map(skill => skill.name);
    expect(runtimeNames).toContain('user-package-skill');
    expect(runtimeNames).toContain('project-package-skill');
    expect(runtimeNames).not.toContain('disabled-skill');
  });

  it('does not create missing legacy resource directories while loading resources', async () => {
    const cwd = createRoot();
    const home = createRoot();
    const globalRoot = createRoot();

    runSkillCatalog(cwd, home, globalRoot);
    await createProjectResourceLoader({
      cwd,
      globalRoot,
      agentDir: join(home, '.pi', 'agent'),
    });

    expect(existsSync(join(globalRoot, 'skills'))).toBe(false);
    expect(existsSync(join(globalRoot, 'extensions'))).toBe(false);
  });

  it('keeps default package management inside the Pi subprocess boundary', () => {
    const sharedBootstrap = readFileSync(
      new URL('../../shared/src/agent-defaults/default-agent-resources.ts', import.meta.url),
      'utf8',
    );
    const runtimeLoader = readFileSync(new URL('./project-resource-loader.ts', import.meta.url), 'utf8');

    expect(sharedBootstrap).not.toContain("from '@earendil-works/pi-coding-agent'");
    expect(runtimeLoader).toContain("from '@earendil-works/pi-coding-agent'");
  });

  it('removes disabled default Pi packages without replacing user packages', async () => {
    const cwd = createRoot();
    const globalRoot = createRoot();
    const agentDir = join(createRoot(), 'agent');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'settings.json'),
      JSON.stringify({ packages: ['npm:existing-package', 'npm:@ayulab/pi-rewind'] }),
    );

    await createProjectResourceLoader({ cwd, globalRoot, agentDir });
    await createProjectResourceLoader({ cwd, globalRoot, agentDir });

    expect(DEFAULT_PI_PACKAGE_SOURCES).toEqual([]);
    expect(JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf8')).packages)
      .toEqual(['npm:existing-package']);
  });

  it('uses packaged Bun for Pi packages without replacing a user command', async () => {
    process.env.CRAFT_BUN = '/packaged/runtime/bun';
    const cwd = createRoot();
    const globalRoot = createRoot();
    const agentDir = join(createRoot(), 'agent');

    await createProjectResourceLoader({ cwd, globalRoot, agentDir });
    expect(JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf8')).npmCommand)
      .toEqual(['bun']);

    writeFileSync(
      join(agentDir, 'settings.json'),
      JSON.stringify({ npmCommand: ['custom-npm'] }),
    );
    await createProjectResourceLoader({ cwd, globalRoot, agentDir });
    expect(JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf8')).npmCommand)
      .toEqual(['custom-npm']);
  });

  it('uses Pi as the single retry owner', async () => {
    const { settingsManager } = await createProjectResourceLoader({
      cwd: createRoot(),
      globalRoot: createRoot(),
      agentDir: join(createRoot(), 'agent'),
    });

    expect(settingsManager.getRetrySettings()).toEqual({
      enabled: true,
      maxRetries: 1,
      baseDelayMs: 2_000,
    });
    expect(settingsManager.getProviderRetrySettings()).toMatchObject({ maxRetries: 0 });
    expect(settingsManager.getHttpIdleTimeoutMs()).toBe(5 * 60 * 1000);
  });

  it('loads Pi Skills without executing project or legacy Extensions', async () => {
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
    writeExtension(
      agentDir,
      'extensions',
      'pi-user-extension',
      'pi-user-extension-tool',
    );
    writeExtension(projectRoot, '.pi/extensions', 'project-extension');

    const { resourceLoader } = await createProjectResourceLoader({
      cwd: projectRoot,
      globalRoot,
      agentDir,
    });

    expect(resourceLoader.getSkills().skills.map(skill => skill.name)).toEqual(
      expect.arrayContaining([
        'global-skill',
        'agent-dir-skill',
        'project-skill',
        'legacy-project-skill',
      ]),
    );
    const extensions = resourceLoader.getExtensions().extensions;
    expect(extensions).toHaveLength(1);
    expect(extensions.some(extension => extension.resolvedPath.includes('global-extension.ts')))
      .toBe(false);
    expect(extensions.some(extension => (
      extension.resolvedPath.includes('pi-user-extension.ts')
      && extension.tools.has('pi-user-extension-tool')
    ))).toBe(true);
    expect(extensions.some(extension => (
      extension.resolvedPath.includes('project-extension.ts')
    ))).toBe(false);
  });

  it('loads Extensions configured by the Pi package manager', async () => {
    const cwd = createRoot();
    const globalRoot = createRoot();
    const agentDir = join(createRoot(), 'agent');
    const packageRoot = join(agentDir, 'native-package');
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      join(packageRoot, 'package.json'),
      JSON.stringify({
        name: 'native-package',
        version: '1.0.0',
        pi: { extensions: ['./index.ts'] },
      }),
    );
    writeExtension(packageRoot, '.', 'index', 'native-package-tool');
    writeFileSync(
      join(agentDir, 'settings.json'),
      JSON.stringify({ packages: ['./native-package'] }),
    );

    const { resourceLoader } = await createProjectResourceLoader({
      cwd,
      globalRoot,
      agentDir,
    });

    expect(resourceLoader.getExtensions().extensions.some(extension => (
      extension.sourceInfo.origin === 'package'
      && extension.tools.has('native-package-tool')
    ))).toBe(true);
  });

  it('does not create a project overlay while loading legacy global Skills', async () => {
    const cwd = createRoot();
    const globalRoot = createRoot();
    const agentDir = join(createRoot(), 'agent');
    writeSkill(globalRoot, 'skills', 'global-only');

    const { resourceLoader } = await createProjectResourceLoader({
      cwd,
      globalRoot,
      agentDir,
    });

    expect(resourceLoader.getSkills().skills.map(skill => skill.name))
      .toContain('global-only');
    expect(existsSync(join(cwd, '.pi'))).toBe(false);
  });

  it('reports Pi collision diagnostics only once', async () => {
    const projectRoot = createRoot();
    const globalRoot = createRoot();
    const agentDir = join(createRoot(), 'agent');
    writeSkill(agentDir, 'skills', 'shared-skill');
    writeSkill(globalRoot, 'skills', 'shared-skill');

    const { resourceLoader } = await createProjectResourceLoader({
      cwd: projectRoot,
      globalRoot,
      agentDir,
    });

    expect(resourceLoader.getSkills().diagnostics.filter(diagnostic => (
      diagnostic.type === 'collision'
      && diagnostic.collision?.name === 'shared-skill'
    ))).toHaveLength(1);
  });

  it('keeps Pi-native project Skill symlink discovery', async () => {
    const projectRoot = createRoot();
    const outsideRoot = createRoot();
    const globalRoot = createRoot();
    const agentDir = join(createRoot(), 'agent');
    writeSkill(outsideRoot, 'skills', 'linked-project-skill');
    mkdirSync(join(projectRoot, '.pi'), { recursive: true });
    symlinkSync(join(outsideRoot, 'skills'), join(projectRoot, '.pi', 'skills'), 'dir');

    const { resourceLoader } = await createProjectResourceLoader({
      cwd: projectRoot,
      globalRoot,
      agentDir,
    });

    expect(resourceLoader.getSkills().skills.map(skill => skill.name))
      .toContain('linked-project-skill');
  });

  it('deduplicates the same Skill reached through a compatibility symlink', async () => {
    const projectRoot = createRoot();
    const outsideRoot = createRoot();
    const globalRoot = createRoot();
    const agentDir = join(createRoot(), 'agent');
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
    });

    expect(resourceLoader.getSkills().skills.filter(skill => skill.name === 'outside-skill'))
      .toHaveLength(1);
  });
});
