// input: bundled default agent resources and temporary user resource directories
// output: regression coverage for first-run default skill/source seeding
// pos: protects the distribution contract for resources visible to every user

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  DEFAULT_AGENT_SKILL_SLUGS,
  DEFAULT_AGENT_SOURCE_SLUGS,
  seedDefaultAgentResources,
} from '../default-agent-resources.ts';

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

  it('seeds bundled resources without overwriting user edits', () => {
    const assetsDir = join(tempDir, 'resources', 'agent-defaults');
    const agentRootDir = join(tempDir, '.agents');
    const existingSkill = join(agentRootDir, 'skills', 'demo-skill', 'SKILL.md');
    const existingSource = join(agentRootDir, 'sources', 'demo-source', 'config.json');

    writeFile(join(assetsDir, 'skills', 'demo-skill', 'SKILL.md'), 'bundled skill');
    writeFile(join(assetsDir, 'sources', 'demo-source', 'config.json'), '{"name":"Bundled"}\n');
    writeFile(join(assetsDir, 'sources', 'demo-source', 'guide.md'), '# Bundled Guide\n');
    writeFile(existingSkill, 'user skill');
    writeFile(existingSource, '{"name":"User"}\n');

    const result = seedDefaultAgentResources({ assetsDir, agentRootDir });

    expect(result.skills.skipped).toEqual(['demo-skill']);
    expect(result.sources.skipped).toEqual(['demo-source']);
    expect(readFileSync(existingSkill, 'utf-8')).toBe('user skill');
    expect(readFileSync(existingSource, 'utf-8')).toBe('{"name":"User"}\n');
  });

  it('does not throw when the user agent root is not writable as a directory', () => {
    const assetsDir = join(tempDir, 'resources', 'agent-defaults');
    const agentRootDir = join(tempDir, '.agents');

    writeFile(join(assetsDir, 'skills', 'demo-skill', 'SKILL.md'), 'bundled skill');
    writeFile(join(assetsDir, 'sources', 'demo-source', 'config.json'), '{"name":"Bundled"}\n');
    writeFileSync(agentRootDir, 'occupied by a file');

    let result: ReturnType<typeof seedDefaultAgentResources> | undefined;

    expect(() => {
      result = seedDefaultAgentResources({ assetsDir, agentRootDir });
    }).not.toThrow();

    expect(result?.skills.imported).toEqual([]);
    expect(result?.skills.failed).toEqual(['demo-skill']);
    expect(result?.sources.imported).toEqual([]);
    expect(result?.sources.failed).toEqual(['demo-source']);
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
