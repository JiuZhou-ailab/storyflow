import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const originalCwd = process.cwd();
const originalConfigDir = process.env.CRAFT_CONFIG_DIR;

afterEach(() => {
  process.chdir(originalCwd);
  if (originalConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR;
  else process.env.CRAFT_CONFIG_DIR = originalConfigDir;
});

describe('ensureDefaultPermissions migration', () => {
  it('merges new bundled defaults into existing installed file and preserves customizations', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'permissions-bundle-'));
    const tempConfig = mkdtempSync(join(tmpdir(), 'permissions-config-'));

    const bundledDir = join(tempRoot, 'resources', 'permissions');
    mkdirSync(bundledDir, { recursive: true });
    writeFileSync(
      join(bundledDir, 'default.json'),
      JSON.stringify({
        version: '2026-03-01',
        allowedBashPatterns: [
          { pattern: '^rg\\b', comment: 'Ripgrep search' },
          { pattern: '^bun\\s+run\\s+typecheck\\b$', comment: 'Typecheck' },
        ],
        allowedMcpPatterns: ['search'],
        allowedApiEndpoints: [],
        allowedWritePaths: [],
        blockedCommandHints: [
          { command: 'printf', reason: 'printf blocked by default' },
        ],
      }, null, 2)
    );

    const installedDir = join(tempConfig, 'permissions');
    mkdirSync(installedDir, { recursive: true });
    writeFileSync(
      join(installedDir, 'default.json'),
      JSON.stringify({
        version: '2026-02-01',
        allowedBashPatterns: [
          { pattern: '^rg\\b', comment: 'User existing pattern' },
          { pattern: '^custom-review\\b', comment: 'User customization' },
        ],
        allowedMcpPatterns: ['list'],
        allowedApiEndpoints: [],
        allowedWritePaths: [],
        blockedCommandHints: [
          { command: 'sed', reason: 'sed print-only policy', whenNotMatching: '^sed\\s+-n\\b' },
        ],
      }, null, 2)
    );

    process.env.CRAFT_CONFIG_DIR = tempConfig;
    process.chdir(tempRoot);

    const mod = await import(`../permissions-config.ts?case=${Date.now()}`);
    mod.ensureDefaultPermissions();

    const merged = JSON.parse(readFileSync(join(installedDir, 'default.json'), 'utf-8'));

    expect(merged.version).toBe('2026-03-01');

    const bashPatterns = merged.allowedBashPatterns.map((p: string | { pattern: string }) =>
      typeof p === 'string' ? p : p.pattern
    );

    expect(bashPatterns).toContain('^custom-review\\b');
    expect(bashPatterns).toContain('^bun\\s+run\\s+typecheck\\b$');
    expect(bashPatterns.filter((p: string) => p === '^rg\\b').length).toBe(1);

    const mcpPatterns = merged.allowedMcpPatterns as string[];
    expect(mcpPatterns).toContain('list');
    expect(mcpPatterns).toContain('search');

    const blockedCommandHints = merged.blockedCommandHints as Array<{ command: string; reason: string }>;
    expect(blockedCommandHints.some(h => h.command === 'printf')).toBe(true);
    expect(blockedCommandHints.some(h => h.command === 'sed')).toBe(true);

    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(tempConfig, { recursive: true, force: true });
  });

  async function migrateMcpPatterns(
    installed: { version: string; mcp: string[] },
    bundled: { version: string; mcp: string[] },
  ) {
    const tempRoot = mkdtempSync(join(tmpdir(), 'permissions-bundle-'));
    const tempConfig = mkdtempSync(join(tmpdir(), 'permissions-config-'));
    try {
      const bundledDir = join(tempRoot, 'resources', 'permissions');
      const installedDir = join(tempConfig, 'permissions');
      mkdirSync(bundledDir, { recursive: true });
      mkdirSync(installedDir, { recursive: true });
      writeFileSync(join(bundledDir, 'default.json'), JSON.stringify({
        version: bundled.version, allowedBashPatterns: [], allowedMcpPatterns: bundled.mcp,
      }));
      writeFileSync(join(installedDir, 'default.json'), JSON.stringify({
        version: installed.version, allowedBashPatterns: [], allowedMcpPatterns: installed.mcp,
      }));

      // afterEach restores cwd and CRAFT_CONFIG_DIR.
      process.env.CRAFT_CONFIG_DIR = tempConfig;
      process.chdir(tempRoot);
      const mod = await import(`../permissions-config.ts?case=retired-${installed.version}-${bundled.version}`);
      mod.ensureDefaultPermissions();
      return JSON.parse(readFileSync(join(installedDir, 'default.json'), 'utf-8'));
    } finally {
      process.chdir(originalCwd);
      rmSync(tempRoot, { recursive: true, force: true });
      rmSync(tempConfig, { recursive: true, force: true });
    }
  }

  it('drops retired bundled MCP verbs from installed defaults on upgrade', async () => {
    const merged = await migrateMcpPatterns(
      { version: '2026-03-07', mcp: ['search', 'list', 'query', 'custom_verb'] },
      { version: '2026-10-10', mcp: ['search', 'list'] },
    );
    expect(merged.version).toBe('2026-10-10');
    expect(merged.allowedMcpPatterns).toEqual(['search', 'list', 'custom_verb']);
  });

  it('keeps a retired verb the user re-added after the retirement', async () => {
    const merged = await migrateMcpPatterns(
      { version: '2026-10-10', mcp: ['search', 'query'] },
      { version: '2026-12-01', mcp: ['search'] },
    );
    expect(merged.allowedMcpPatterns).toEqual(['search', 'query']);
  });
});
