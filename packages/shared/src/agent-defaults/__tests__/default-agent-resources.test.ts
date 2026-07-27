// input: Bundled defaults, user-owned global resource directories, and process environment
// output: Regression coverage for the minimal product Skills, Sources, and AnySearch credential
// pos: Protects Storyflow global resource seeding without project mutations

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  DEFAULT_GLOBAL_AGENT_SKILL_SLUGS,
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
  it('declares only the product Skills and Wangwen BigData Source', () => {
    expect(DEFAULT_GLOBAL_AGENT_SKILL_SLUGS).toEqual([
      'anysearch',
      'skill-creator',
      'sn2s-novel-to-screenplay',
    ]);
    expect(DEFAULT_AGENT_SOURCE_SLUGS).toEqual(['wangwen-bigdata']);
  });

  it('seeds global defaults without overwriting user edits', () => {
    const assetsDir = join(tempDir, 'resources', 'agent-defaults');
    const agentRootDir = join(tempDir, '.craft-agent');
    const existingSource = join(agentRootDir, 'sources', 'demo-source', 'config.json');

    writeFile(join(assetsDir, 'global-skills', 'skill-creator', 'SKILL.md'), 'product skill');
    writeFile(join(assetsDir, 'sources', 'demo-source', 'config.json'), '{"name":"Bundled"}\n');
    writeFile(join(assetsDir, 'sources', 'demo-source', 'guide.md'), '# Bundled Guide\n');
    writeFile(existingSource, '{"name":"User"}\n');

    const result = seedDefaultAgentResources({ assetsDir, agentRootDir });

    expect(result.skills.imported).toEqual(['skill-creator']);
    expect(result.sources.skipped).toEqual(['demo-source']);
    expect(readFileSync(join(agentRootDir, 'skills', 'skill-creator', 'SKILL.md'), 'utf-8')).toBe('product skill');
    expect(readFileSync(existingSource, 'utf-8')).toBe('{"name":"User"}\n');
  });

  it('does not overwrite a customized global product Skill', () => {
    const assetsDir = join(tempDir, 'resources', 'agent-defaults');
    const agentRootDir = join(tempDir, '.craft-agent');
    const existingSkill = join(agentRootDir, 'skills', 'skill-creator', 'SKILL.md');

    writeFile(join(assetsDir, 'global-skills', 'skill-creator', 'SKILL.md'), 'product skill');
    writeFile(existingSkill, 'user skill');

    const result = seedDefaultAgentResources({ assetsDir, agentRootDir });

    expect(result.skills.skipped).toEqual(['skill-creator']);
    expect(readFileSync(existingSkill, 'utf-8')).toBe('user skill');
  });

  it('provides the shared AnySearch key without overriding user configuration', () => {
    const previousKey = process.env.ANYSEARCH_API_KEY;

    try {
      delete process.env.ANYSEARCH_API_KEY;
      seedDefaultAgentResources({
        assetsDir: join(tempDir, 'resources', 'agent-defaults'),
        agentRootDir: join(tempDir, '.craft-agent'),
      });
      expect(process.env.ANYSEARCH_API_KEY).toMatch(/^as_sk_/);

      process.env.ANYSEARCH_API_KEY = 'user-configured-key';
      seedDefaultAgentResources({
        assetsDir: join(tempDir, 'resources', 'agent-defaults'),
        agentRootDir: join(tempDir, '.craft-agent'),
      });
      expect(process.env.ANYSEARCH_API_KEY).toBe('user-configured-key');
    } finally {
      if (previousKey === undefined) {
        delete process.env.ANYSEARCH_API_KEY;
      } else {
        process.env.ANYSEARCH_API_KEY = previousKey;
      }
    }
  });

  it('does not throw when the Craft root is not writable as a directory', () => {
    const assetsDir = join(tempDir, 'resources', 'agent-defaults');
    const agentRootDir = join(tempDir, '.craft-agent');

    writeFile(join(assetsDir, 'global-skills', 'skill-creator', 'SKILL.md'), 'product skill');
    writeFile(join(assetsDir, 'sources', 'demo-source', 'config.json'), '{"name":"Bundled"}\n');
    writeFileSync(agentRootDir, 'occupied by a file');

    let result: ReturnType<typeof seedDefaultAgentResources> | undefined;

    expect(() => {
      result = seedDefaultAgentResources({ assetsDir, agentRootDir });
    }).not.toThrow();

    expect(result?.skills.imported).toEqual([]);
    expect(result?.skills.failed).toEqual(['skill-creator']);
    expect(result?.sources.imported).toEqual([]);
    expect(result?.sources.failed).toEqual(['demo-source']);
  });

  it('ships reviewable default resources without local runtime state', () => {
    const assetsDir = join(import.meta.dir, '../../../../../apps/electron/resources/agent-defaults');

    for (const slug of DEFAULT_GLOBAL_AGENT_SKILL_SLUGS) {
      expect(existsSync(join(assetsDir, 'global-skills', slug, 'SKILL.md'))).toBe(true);
    }
    expect(existsSync(join(assetsDir, 'skills'))).toBe(false);

    const anysearchDir = join(assetsDir, 'global-skills', 'anysearch');
    const anysearchSkill = readFileSync(join(anysearchDir, 'SKILL.md'), 'utf-8');
    expect(anysearchSkill).toContain('**recommended** search tool');
    expect(existsSync(join(anysearchDir, 'scripts', 'anysearch_cli.js'))).toBe(true);
    expect(existsSync(join(anysearchDir, '.env'))).toBe(false);
    expect(existsSync(join(anysearchDir, 'runtime.conf'))).toBe(false);

    const sn2sDir = join(assetsDir, 'global-skills', 'sn2s-novel-to-screenplay');
    const sn2sSkill = readFileSync(join(sn2sDir, 'SKILL.md'), 'utf-8');
    expect(sn2sSkill).toContain('requires no external SN2S server');
    expect(existsSync(join(sn2sDir, 'scripts', 'screenplay_project.py'))).toBe(true);
    expect(existsSync(join(sn2sDir, 'references', 'workflow.md'))).toBe(true);
    expect(existsSync(join(sn2sDir, 'references', 'adaptation-policy.md'))).toBe(true);
    expect(existsSync(join(sn2sDir, 'references', 'screenplay-format.md'))).toBe(true);

    const wangwenConfig = readFileSync(join(assetsDir, 'sources', 'wangwen-bigdata', 'config.json'), 'utf-8');
    expect(wangwenConfig).toContain('"slug": "wangwen-bigdata"');
    expect(wangwenConfig).not.toContain('X-MCP-API-Key');
    expect(wangwenConfig).not.toContain('wwmcp_');
  });
});
