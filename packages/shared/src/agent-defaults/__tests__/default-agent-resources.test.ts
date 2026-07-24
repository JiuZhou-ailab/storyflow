// input: Bundled defaults, explicit project Skill installation, symlinks, and user Source directories
// output: Regression coverage for opt-in project Skills and global Source seeding
// pos: Protects resource scope and project filesystem boundaries

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  DEFAULT_AGENT_SKILL_SLUGS,
  DEFAULT_AGENT_SOURCE_SLUGS,
  seedDefaultAgentResources,
  seedDefaultProjectSkills,
} from '../default-agent-resources.ts';
import { getWorkspaceSkillsPath } from '../../workspaces/paths.ts';

let tempDir: string;

function writeFile(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'craft-agent-default-resources-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('default agent resources', () => {
  it('declares the default writing skills and Wangwen BigData source', () => {
    expect(DEFAULT_AGENT_SKILL_SLUGS).toEqual([
      'character-design',
      'outline-architecture',
      'plot-causality-audit',
      'prose-drafting',
      'prose-revision',
      'story-ideation',
      'story-state-ledger',
      'storyflow-tutorial',
      'webnovel-short-diagnose',
    ]);
    expect(DEFAULT_AGENT_SOURCE_SLUGS).toEqual(['wangwen-bigdata']);
  });

  it('seeds Sources globally and Skills into a project without overwriting user edits', () => {
    const assetsDir = join(tempDir, 'resources', 'agent-defaults');
    const agentRootDir = join(tempDir, '.craft-agent');
    const projectRoot = join(tempDir, 'project');
    const existingSkill = join(projectRoot, '.pi', 'skills', 'demo-skill', 'SKILL.md');
    const existingSource = join(agentRootDir, 'sources', 'demo-source', 'config.json');

    writeFile(join(assetsDir, 'skills', 'demo-skill', 'SKILL.md'), 'bundled skill');
    writeFile(join(assetsDir, 'sources', 'demo-source', 'config.json'), '{"name":"Bundled"}\n');
    writeFile(join(assetsDir, 'sources', 'demo-source', 'guide.md'), '# Bundled Guide\n');
    writeFile(existingSkill, 'user skill');
    writeFile(existingSource, '{"name":"User"}\n');

    const result = seedDefaultAgentResources({ assetsDir, agentRootDir });
    const projectResult = seedDefaultProjectSkills(projectRoot, { assetsDir });

    expect(result.skills).toEqual({ imported: [], skipped: [], failed: [] });
    expect(projectResult.skipped).toEqual(['demo-skill']);
    expect(result.sources.skipped).toEqual(['demo-source']);
    expect(readFileSync(existingSkill, 'utf-8')).toBe('user skill');
    expect(readFileSync(existingSource, 'utf-8')).toBe('{"name":"User"}\n');
  });

  it('does not throw when the Craft root is not writable as a directory', () => {
    const assetsDir = join(tempDir, 'resources', 'agent-defaults');
    const agentRootDir = join(tempDir, '.craft-agent');

    writeFile(join(assetsDir, 'skills', 'demo-skill', 'SKILL.md'), 'bundled skill');
    writeFile(join(assetsDir, 'sources', 'demo-source', 'config.json'), '{"name":"Bundled"}\n');
    writeFileSync(agentRootDir, 'occupied by a file');

    let result: ReturnType<typeof seedDefaultAgentResources> | undefined;

    expect(() => {
      result = seedDefaultAgentResources({ assetsDir, agentRootDir });
    }).not.toThrow();

    expect(result?.skills.imported).toEqual([]);
    expect(result?.skills.failed).toEqual([]);
    expect(result?.sources.imported).toEqual([]);
    expect(result?.sources.failed).toEqual(['demo-source']);
  });

  it('does not install through a symlinked .pi ancestor', () => {
    const assetsDir = join(tempDir, 'resources', 'agent-defaults');
    const projectRoot = join(tempDir, 'project');
    const outsideRoot = join(tempDir, 'outside');

    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(outsideRoot, { recursive: true });
    symlinkSync(outsideRoot, join(projectRoot, '.pi'), 'dir');
    writeFile(join(assetsDir, 'skills', 'bundled-skill', 'SKILL.md'), 'bundled skill');

    const result = seedDefaultProjectSkills(projectRoot, { assetsDir });

    expect(result.failed).toEqual(['bundled-skill']);
    expect(existsSync(join(outsideRoot, 'skills', 'bundled-skill'))).toBe(false);
  });

  it('ships reviewable default resources without bundled secrets', () => {
    const assetsDir = join(import.meta.dir, '../../../../../apps/electron/resources/agent-defaults');

    for (const slug of DEFAULT_AGENT_SKILL_SLUGS) {
      expect(existsSync(join(assetsDir, 'skills', slug, 'SKILL.md'))).toBe(true);
    }

    const wangwenConfig = readFileSync(join(assetsDir, 'sources', 'wangwen-bigdata', 'config.json'), 'utf-8');
    expect(wangwenConfig).toContain('"slug": "wangwen-bigdata"');
    expect(wangwenConfig).not.toContain('X-MCP-API-Key');
    expect(wangwenConfig).not.toContain('wwmcp_');
  });
});
