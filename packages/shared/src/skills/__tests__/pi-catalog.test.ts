// input: Temporary Pi user/project Skill roots
// output: Proof that Storyflow projects Pi's native Skill catalog without redefining discovery
// pos: Integration contract shared by the Skills UI and Pi runtime

import { afterEach, describe, expect, it } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  collectEvents,
  createMockBackendConfig,
  createMockSession,
  TestAgent,
} from '../../agent/__tests__/test-utils.ts';
import { loadPiSkillCatalog } from '../pi-catalog.ts';

const roots: string[] = [];

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'storyflow-skill-catalog-'));
  roots.push(root);
  return root;
}

function writeSkill(
  root: string,
  relativeDir: string,
  slug: string,
  requiredSources: string[] = [],
): void {
  const skillDir = join(root, relativeDir, slug);
  mkdirSync(skillDir, { recursive: true });
  const requiredSourcesYaml = requiredSources.length > 0
    ? `requiredSources:\n${requiredSources.map(source => `  - ${source}`).join('\n')}\n`
    : '';
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---
name: ${slug}
description: ${slug} description
metadata:
  displayName: ${slug} display
${requiredSourcesYaml}---

# ${slug}
`,
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

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('loadPiSkillCatalog', () => {
  it('lets the Pi Product Host resolve project .agents Skills from the session working directory', async () => {
    const cwd = createRoot();
    const slug = `runtime-project-skill-${process.pid}`;
    writeSkill(cwd, '.agents/skills', slug);
    const agent = new TestAgent(createMockBackendConfig({
      session: createMockSession({ workingDirectory: cwd }),
    }));

    const events = await collectEvents(agent.chat(`[skill:${slug}] apply it`));

    expect(events.some(event => event.type === 'error')).toBe(false);
    expect(agent.chatCalls).toHaveLength(1);
    expect(agent.chatCalls[0]?.message).toBe(`/skill:${slug} apply it`);
    agent.destroy();
  });

  it('projects Pi user, project, and additional Skills with their native scope', async () => {
    const cwd = createRoot();
    const userAgentDir = join(createRoot(), 'agent');
    const legacyRoot = createRoot();
    writeSkill(userAgentDir, 'skills', 'user-skill');
    writeSkill(cwd, '.pi/skills', 'project-skill', ['linear']);
    writeSkill(legacyRoot, 'skills', 'legacy-skill');

    const catalog = await loadPiSkillCatalog(cwd, {
      agentDir: userAgentDir,
      additionalSkillPaths: [join(legacyRoot, 'skills')],
    });

    expect(catalog.skills.find(skill => skill.slug === 'user-skill')?.scope).toBe('user');
    expect(catalog.skills.find(skill => skill.slug === 'project-skill')?.scope).toBe('project');
    expect(catalog.skills.find(skill => skill.slug === 'legacy-skill')?.scope).toBe('temporary');
    expect(catalog.skills.find(skill => skill.slug === 'project-skill')?.metadata.displayName)
      .toBe('project-skill display');
    expect(catalog.skills.find(skill => skill.slug === 'project-skill')?.metadata.requiredSources)
      .toEqual(['linear']);
  });

  it('preserves Pi collision diagnostics and the winning definition', async () => {
    const cwd = createRoot();
    const userAgentDir = join(createRoot(), 'agent');
    writeSkill(userAgentDir, 'skills', 'shared-skill');
    writeSkill(cwd, '.pi/skills', 'shared-skill');

    const catalog = await loadPiSkillCatalog(cwd, {
      agentDir: userAgentDir,
      additionalSkillPaths: [],
    });

    expect(catalog.skills.filter(skill => skill.slug === 'shared-skill')).toHaveLength(1);
    expect(catalog.diagnostics.some(diagnostic => (
      diagnostic.type === 'collision'
      && diagnostic.collision?.name === 'shared-skill'
    ))).toBe(true);
  });

  it('uses file-backed package and disabled settings in the in-process catalog', async () => {
    const cwd = createRoot();
    const agentDir = join(createRoot(), 'agent');
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

    const catalog = await loadPiSkillCatalog(cwd, {
      agentDir,
      additionalSkillPaths: [],
    });
    const names = catalog.skills.map(skill => skill.slug);

    expect(names).toContain('user-package-skill');
    expect(names).toContain('project-package-skill');
    expect(names).not.toContain('disabled-skill');
  });
});
