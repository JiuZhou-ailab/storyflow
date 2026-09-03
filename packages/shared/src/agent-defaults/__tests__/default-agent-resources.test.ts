// input: Bundled defaults and user-owned global resource directories
// output: Regression coverage for the minimal product Skills and Sources
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
  isDefaultGlobalAgentSkillSlug,
  seedDefaultAgentResources,
} from '../default-agent-resources.ts';
import { validatePermissionsContent, validateSourceConfig } from '../../config/validators.ts';
import { validateSkillDocumentForSlug } from '../../skills/storage.ts';

let tempDir: string;

const LEGACY_PRODUCT_CATALOG_CONFIG = {
  id: 'builtin-storyflow-catalog',
  name: '爆款短剧数据',
  slug: 'storyflow-catalog',
  enabled: false,
  provider: 'storyflow',
  type: 'mcp',
  icon: '🎬',
  tagline: '红果、GoodShort、ReelShort 与 DataEye 的榜单和媒资数据',
  mcp: {
    transport: 'http',
    url: 'http://172.16.33.103:8789/mcp',
    authType: 'none',
  },
  createdAt: 1786118400000,
  updatedAt: 1787068800000,
  connectionStatus: 'untested',
};

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
  it('declares the authenticated product Skills and default research Sources', () => {
    expect(DEFAULT_GLOBAL_AGENT_SKILL_SLUGS).toEqual([
      'find-skills',
      'firecrawl',
      'skill-creator',
      'storyflow-tutorial',
      'sn2s-novel-to-screenplay',
    ]);
    expect(DEFAULT_AGENT_SOURCE_SLUGS).toEqual(['storyflow-catalog', 'wangwen-bigdata']);
    expect(isDefaultGlobalAgentSkillSlug('find-skills')).toBe(true);
    expect(isDefaultGlobalAgentSkillSlug('firecrawl')).toBe(true);
    expect(isDefaultGlobalAgentSkillSlug('skill-creator')).toBe(true);
    expect(isDefaultGlobalAgentSkillSlug('custom-skill')).toBe(false);
  });

  it('seeds global defaults without overwriting user edits', () => {
    const assetsDir = join(tempDir, 'resources', 'agent-defaults');
    const agentRootDir = join(tempDir, '.craft-agent');
    const existingSource = join(agentRootDir, 'sources', 'demo-source', 'config.json');

    writeFile(join(assetsDir, 'global-skills', 'firecrawl', 'SKILL.md'), 'managed skill');
    writeFile(join(assetsDir, 'global-skills', 'skill-creator', 'SKILL.md'), 'product skill');
    writeFile(join(assetsDir, 'sources', 'demo-source', 'config.json'), '{"name":"Bundled"}\n');
    writeFile(join(assetsDir, 'sources', 'demo-source', 'guide.md'), '# Bundled Guide\n');
    writeFile(existingSource, '{"name":"User"}\n');

    const result = seedDefaultAgentResources({ assetsDir, agentRootDir });

    expect(result.skills.imported).toEqual(['firecrawl', 'skill-creator']);
    expect(result.sources.skipped).toEqual(['demo-source']);
    expect(readFileSync(join(agentRootDir, 'skills', 'skill-creator', 'SKILL.md'), 'utf-8')).toBe('product skill');
    expect(readFileSync(join(agentRootDir, 'skills', 'firecrawl', 'SKILL.md'), 'utf-8')).toBe('managed skill');
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

  it('can seed Pi user Skills separately from Storyflow Sources', () => {
    const assetsDir = join(tempDir, 'resources', 'agent-defaults');
    const agentRootDir = join(tempDir, '.craft-agent');
    const skillsDir = join(tempDir, '.pi', 'agent', 'skills');

    writeFile(join(assetsDir, 'global-skills', 'skill-creator', 'SKILL.md'), 'product skill');
    writeFile(join(assetsDir, 'sources', 'demo-source', 'config.json'), '{"name":"Bundled"}\n');

    seedDefaultAgentResources({ assetsDir, agentRootDir, skillsDir });

    expect(readFileSync(join(skillsDir, 'skill-creator', 'SKILL.md'), 'utf-8')).toBe('product skill');
    expect(existsSync(join(agentRootDir, 'skills'))).toBe(false);
    expect(existsSync(join(agentRootDir, 'sources', 'demo-source', 'config.json'))).toBe(true);
  });

  it('does not overwrite a customized built-in legacy Catalog', () => {
    const assetsDir = join(tempDir, 'resources', 'agent-defaults');
    const agentRootDir = join(tempDir, '.craft-agent');
    const bundledConfig = {
      id: 'builtin-storyflow-catalog',
      name: '爆款短剧数据',
      slug: 'storyflow-catalog',
      enabled: true,
      provider: 'storyflow',
      type: 'mcp',
      mcp: {
        transport: 'http',
        url: 'http://47.91.2.252:9000/mcp',
        authType: 'none',
      },
    };
    const legacyConfig = {
      id: 'builtin-storyflow-catalog',
      name: 'Storyflow Catalog',
      slug: 'storyflow-catalog',
      enabled: true,
      provider: 'storyflow',
      type: 'api',
      api: {
        baseUrl: 'https://storyflow-model.zjding.com',
        authType: 'managed',
        testEndpoint: { method: 'GET', path: '/v2/catalog/sources' },
        operations: [
          { name: 'list_sources', method: 'GET', path: '/v2/catalog/sources' },
          { name: 'list_ranking_snapshots', method: 'GET', path: '/v2/ranking-snapshots' },
          { name: 'search_rankings', method: 'GET', path: '/v2/rankings' },
          { name: 'get_conversion_manifest', method: 'GET', path: '/v2/series/{source}/{sourceId}/manifest' },
        ],
      },
    };
    const configPath = join(agentRootDir, 'sources', 'storyflow-catalog', 'config.json');
    const guidePath = join(agentRootDir, 'sources', 'storyflow-catalog', 'guide.md');
    const permissionsPath = join(agentRootDir, 'sources', 'storyflow-catalog', 'permissions.json');
    writeFile(join(assetsDir, 'sources', 'storyflow-catalog', 'config.json'), `${JSON.stringify(bundledConfig)}\n`);
    writeFile(join(assetsDir, 'sources', 'storyflow-catalog', 'guide.md'), 'new MCP guide');
    writeFile(join(assetsDir, 'sources', 'storyflow-catalog', 'permissions.json'), '{"allowedMcpPatterns":[{"pattern":"^short2api_search$"}]}\n');
    writeFile(configPath, `${JSON.stringify(legacyConfig)}\n`);
    writeFile(guidePath, 'customized legacy API guide');
    writeFile(permissionsPath, '{"allowedMcpPatterns":["list"]}\n');

    const result = seedDefaultAgentResources({ assetsDir, agentRootDir });
    expect(result.sources.imported).toEqual([]);
    expect(result.sources.skipped).toEqual(['storyflow-catalog']);
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual(legacyConfig);
    expect(readFileSync(guidePath, 'utf8')).toBe('customized legacy API guide');
    expect(readFileSync(permissionsPath, 'utf8')).toBe('{"allowedMcpPatterns":["list"]}\n');
    expect(existsSync(join(agentRootDir, 'sources', 'storyflow-catalog', '.migration-backup'))).toBe(false);
  });

  it('migrates an unmodified product-owned MCP endpoint without re-enabling a disabled Source', () => {
    const assetsDir = join(tempDir, 'resources', 'agent-defaults');
    const agentRootDir = join(tempDir, '.craft-agent');
    const bundledDir = join(assetsDir, 'sources', 'storyflow-catalog');
    const installedDir = join(agentRootDir, 'sources', 'storyflow-catalog');
    const bundled = {
      id: 'builtin-storyflow-catalog', slug: 'storyflow-catalog', provider: 'storyflow', type: 'mcp', enabled: true,
      tagline: 'ReelShort、DramaBox 与 NetShort 的剧目、分集和播放数据',
      mcp: { transport: 'http', url: 'http://47.91.2.252:9000/mcp', authType: 'none' },
    };
    const installed = LEGACY_PRODUCT_CATALOG_CONFIG;
    writeFile(join(bundledDir, 'config.json'), `${JSON.stringify(bundled)}\n`);
    writeFile(join(bundledDir, 'guide.md'), 'new guide');
    writeFile(join(bundledDir, 'permissions.json'), '{}\n');
    writeFile(join(installedDir, 'config.json'), `${JSON.stringify(installed)}\n`);
    writeFile(join(installedDir, 'guide.md'), 'new guide');
    writeFile(join(installedDir, 'permissions.json'), '{}\n');

    seedDefaultAgentResources({ assetsDir, agentRootDir });

    const migrated = JSON.parse(readFileSync(join(installedDir, 'config.json'), 'utf8'));
    expect(migrated.enabled).toBe(false);
    expect(migrated.tagline).toBe('ReelShort、DramaBox 与 NetShort 的剧目、分集和播放数据');
    expect(migrated.mcp.url).toBe('http://47.91.2.252:9000/mcp');
    expect(migrated.mcp.headers).toBeUndefined();
    expect(existsSync(join(installedDir, '.migration-backup'))).toBe(false);
  });

  it('does not throw when the Craft root is not writable as a directory', () => {
    const assetsDir = join(tempDir, 'resources', 'agent-defaults');
    const agentRootDir = join(tempDir, '.craft-agent');

    writeFile(join(assetsDir, 'global-skills', 'skill-creator', 'SKILL.md'), 'product skill');
    writeFile(join(assetsDir, 'sources', 'demo-source', 'config.json'), '{"name":"Bundled"}\n');
    writeFileSync(agentRootDir, 'occupied by a file');

    const result = seedDefaultAgentResources({ assetsDir, agentRootDir });

    expect(result?.skills.imported).toEqual([]);
    expect(result?.skills.failed).toEqual([
      'find-skills',
      'firecrawl',
      'skill-creator',
      'storyflow-tutorial',
      'sn2s-novel-to-screenplay',
    ]);
    expect(result?.sources.imported).toEqual([]);
    expect(result?.sources.failed).toEqual(['demo-source']);
  });

  it('leaves the legacy Catalog config retryable when companion migration fails', () => {
    const assetsDir = join(tempDir, 'resources', 'agent-defaults');
    const agentRootDir = join(tempDir, '.craft-agent');
    const installedDir = join(agentRootDir, 'sources', 'storyflow-catalog');
    const configPath = join(installedDir, 'config.json');

    writeFile(join(assetsDir, 'sources', 'storyflow-catalog', 'config.json'), '{"type":"mcp"}\n');
    writeFile(join(assetsDir, 'sources', 'storyflow-catalog', 'guide.md'), 'new guide');
    writeFile(join(assetsDir, 'sources', 'storyflow-catalog', 'permissions.json'), '{}\n');
    writeFile(configPath, `${JSON.stringify(LEGACY_PRODUCT_CATALOG_CONFIG)}\n`);
    writeFile(join(installedDir, 'guide.md'), 'new guide');
    mkdirSync(join(installedDir, 'permissions.json'), { recursive: true });

    seedDefaultAgentResources({ assetsDir, agentRootDir });

    expect(JSON.parse(readFileSync(configPath, 'utf8')).mcp.url).toBe('http://172.16.33.103:8789/mcp');
  });

  it('ships reviewable default resources without local runtime state', () => {
    const assetsDir = join(import.meta.dir, '../../../../../apps/electron/resources/agent-defaults');

    for (const slug of DEFAULT_GLOBAL_AGENT_SKILL_SLUGS) {
      expect(existsSync(join(assetsDir, 'global-skills', slug, 'SKILL.md'))).toBe(true);
    }
    expect(existsSync(join(assetsDir, 'skills'))).toBe(false);

    const findSkillsDir = join(assetsDir, 'global-skills', 'find-skills');
    const findSkills = readFileSync(join(findSkillsDir, 'SKILL.md'), 'utf-8');
    expect(validateSkillDocumentForSlug(findSkills, 'find-skills')).toBeNull();
    expect(findSkills).toContain('https://storyflow-skills.zjding.com/');
    expect(findSkills.replace(/\s+/g, ' ')).toContain("current project's `.pi/skills`");
    expect(findSkills).toContain("Storyflow uses Pi's native Agent Skills discovery");
    expect(existsSync(join(findSkillsDir, 'LICENSE.txt'))).toBe(true);

    const tutorial = readFileSync(
      join(assetsDir, 'global-skills', 'storyflow-tutorial', 'SKILL.md'),
      'utf-8',
    );
    expect(validateSkillDocumentForSlug(tutorial, 'storyflow-tutorial')).toBeNull();
    expect(tutorial).toContain('设置 → 偏好 → 系统指令');

    const firecrawl = readFileSync(
      join(assetsDir, 'global-skills', 'firecrawl', 'SKILL.md'),
      'utf-8',
    );
    expect(validateSkillDocumentForSlug(firecrawl, 'firecrawl')).toBeNull();
    expect(firecrawl).toContain('`web_scrape`');
    expect(firecrawl).not.toContain('API_KEY');
    expect(firecrawl).not.toContain('web_search');
    expect(firecrawl).not.toContain('web_fetch');

    const wangwenConfig = readFileSync(join(assetsDir, 'sources', 'wangwen-bigdata', 'config.json'), 'utf-8');
    expect(wangwenConfig).toContain('"slug": "wangwen-bigdata"');
    expect(wangwenConfig).not.toContain('X-MCP-API-Key');
    expect(wangwenConfig).not.toContain('wwmcp_');

    const catalogDir = join(assetsDir, 'sources', 'storyflow-catalog');
    const catalogConfig = readFileSync(join(catalogDir, 'config.json'), 'utf-8');
    const catalogPermissions = readFileSync(join(catalogDir, 'permissions.json'), 'utf-8');
    expect(catalogConfig).toContain('"slug": "storyflow-catalog"');
    expect(catalogConfig).toContain('"type": "mcp"');
    const parsedCatalogConfig = JSON.parse(catalogConfig);
    expect(parsedCatalogConfig.mcp.authType).toBe('none');
    expect(parsedCatalogConfig.mcp.headers).toBeUndefined();
    expect(catalogConfig).toContain('"url": "http://47.91.2.252:9000/mcp"');
    expect(catalogConfig).not.toContain('MODEL_ACCESS_BROKER_TOKEN');
    expect(validateSourceConfig(JSON.parse(catalogConfig)).valid).toBe(true);
    expect(validatePermissionsContent(catalogPermissions).valid).toBe(true);
    expect(readFileSync(join(catalogDir, 'guide.md'), 'utf-8')).not.toContain('SELECT ');
  });

});
