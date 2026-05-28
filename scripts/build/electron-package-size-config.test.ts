// input: Electron builder and renderer build configuration
// output: Regression coverage that release packages exclude duplicated and development-only files
// pos: Package-size guard for desktop release artifacts

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

const rootDir = join(import.meta.dir, '..', '..');

function readRepoFile(path: string): string {
  return readFileSync(join(rootDir, path), 'utf8');
}

function readBuilderConfig(): Record<string, any> {
  return yaml.load(readRepoFile('apps/electron/electron-builder.yml')) as Record<string, any>;
}

function expectExplicitPackagedAppAllowlist(platform: 'mac' | 'win' | 'linux'): void {
  const config = readBuilderConfig();
  const files = effectiveFilePatterns(config, platform);

  expect(Array.isArray(files), `${platform}.files must be an explicit allowlist`).toBe(true);
  expect(files).toContain('dist/**/*');
  expect(files).toContain('package.json');
  expect(files).toContain('!node_modules/**/*');
  expect(files).toContain('!src/**/*');
  expect(files).toContain('!resources/**/*');
  expect(files).toContain('!release/**/*');
  expect(files).toContain('!**/*.map');
  expect(files[0], `${platform}.files must not fall back to electron-builder's **/* default`).toBe('dist/**/*');
}

function effectiveFilePatterns(config: Record<string, any>, platform: 'mac' | 'win' | 'linux'): string[] {
  return [
    ...(Array.isArray(config.files) ? config.files : []),
    ...(Array.isArray(config[platform]?.files) ? config[platform].files : []),
  ];
}

function collectExtraResourceTargets(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const resources = (value as { extraResources?: unknown }).extraResources;
  if (!Array.isArray(resources)) return [];
  return resources
    .map((entry) => entry && typeof entry === 'object' ? (entry as { to?: unknown }).to : undefined)
    .filter((target): target is string => typeof target === 'string');
}

describe('Electron package size configuration', () => {
  test('uses explicit platform allowlists instead of negative-only platform file rules', () => {
    expectExplicitPackagedAppAllowlist('mac');
    expectExplicitPackagedAppAllowlist('win');
    expectExplicitPackagedAppAllowlist('linux');
  });

  test('keeps runtime resources single-rooted under dist/resources in packaged app payload', () => {
    const config = readBuilderConfig();
    const allFilePatterns = [
      ...config.files,
      ...config.mac.files,
      ...config.win.files,
      ...config.linux.files,
    ];

    expect(allFilePatterns).not.toContain('resources/bridge-mcp-server/**/*');
    expect(allFilePatterns).not.toContain('resources/session-mcp-server/**/*');
    expect(allFilePatterns).not.toContain('resources/pi-agent-server/**/*');
    expect(allFilePatterns).not.toContain('resources/bin/darwin-arm64/**/*');
    expect(allFilePatterns).not.toContain('resources/bin/win32-x64/**/*');
    expect(allFilePatterns).not.toContain('resources/bin/linux-x64/**/*');
  });

  test('does not include source directories in effective app file patterns', () => {
    const config = readBuilderConfig();

    for (const platform of ['mac', 'win', 'linux'] as const) {
      const patterns = effectiveFilePatterns(config, platform);
      const positivePatterns = patterns.filter((pattern) => !pattern.startsWith('!'));

      expect(positivePatterns).not.toContain('packages/shared/src/unified-network-interceptor.ts');
      expect(positivePatterns).not.toContain('packages/shared/src/interceptor-common.ts');
      expect(positivePatterns).not.toContain('packages/shared/src/feature-flags.ts');
      expect(positivePatterns).not.toContain('packages/shared/src/interceptor-request-utils.ts');
      expect(positivePatterns.filter((pattern) => /(^|\/)src(\/|$)/.test(pattern))).toEqual([]);
    }
  });

  test('does not copy extra resources into legacy app/resources paths', () => {
    const config = readBuilderConfig();
    const targets = [
      ...collectExtraResourceTargets(config.mac),
      ...collectExtraResourceTargets(config.win),
      ...collectExtraResourceTargets(config.linux),
    ];

    expect(targets).not.toContain('app/resources/bin/win32-x64');
    expect(targets.filter((target) => target.startsWith('app/resources/'))).toEqual([]);
    expect(targets).toContain('app/dist/resources/bin/win32-x64');
    expect(targets).toContain('vendor/bun/bun.exe');
  });

  test('does not generate renderer source maps for production packages by default', () => {
    const viteConfig = readRepoFile('apps/electron/vite.config.ts');

    expect(viteConfig).toContain("sourcemap: process.env.CRAFT_RENDERER_SOURCEMAP === '1'");
    expect(viteConfig).not.toContain('sourcemap: true');
  });
});
