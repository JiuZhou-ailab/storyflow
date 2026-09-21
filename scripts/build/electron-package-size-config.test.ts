// input: Electron builder and renderer build configuration
// output: Regression coverage that release packages exclude duplicated and development-only files
// pos: Package-size guard for desktop release artifacts

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { doMergeConfigs } from 'app-builder-lib/out/util/config/config';
import type { FileMatcher } from 'app-builder-lib/out/fileMatcher';
// This pinned runtime API is marked internal and omitted from the published .d.ts.
const { getMainFileMatchers } = require('app-builder-lib/out/fileMatcher') as {
  getMainFileMatchers: (from: string, to: string, expand: (value: string) => string, platform: unknown, packager: unknown, out: string, compile: boolean) => FileMatcher[];
};
import yaml from 'js-yaml';
import { SUPPORTED_LANGUAGE_CODES } from '../../packages/shared/src/i18n/languages';

const rootDir = join(import.meta.dir, '..', '..');

function readRepoFile(path: string): string {
  return readFileSync(join(rootDir, path), 'utf8');
}

function readBuilderConfig(): Record<string, any> {
  return yaml.load(readRepoFile('apps/electron/electron-builder.yml')) as Record<string, any>;
}

// Use the installed builder, not concatenated globs that conceal its **/* fallback.
function selectedFiles(platform: 'mac' | 'win' | 'linux', files: string[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'storyflow-package-files-'));
  try {
    for (const file of files) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), 'fixture');
    }
    const config = doMergeConfigs([readBuilderConfig()]);
    const matchers = getMainFileMatchers(dir, join(dir, 'out'), value => value.replaceAll('${arch}', platform === 'mac' ? 'arm64' : 'x64'), config[platform], {
      info: { config, projectDir: dir, buildResourcesDir: 'resources',
        isPrepackedAppAsar: false, debugLogger: { isEnabled: false } },
    } as Parameters<typeof getMainFileMatchers>[4], join(dir, 'release'), false);
    const filters = matchers!.map(matcher => matcher.createFilter());
    return files.filter(file => filters.some(filter => filter(join(dir, file), statSync(join(dir, file)))));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
  test('electron build stages resources once and validates the staged output', () => {
    const rootPackage = JSON.parse(readRepoFile('package.json')) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts['electron:build']).not.toContain(
      'electron:build:resources && bun run electron:build:assets',
    );
    expect(rootPackage.scripts['electron:build']).toContain('electron:build:assets');
    expect(rootPackage.scripts['electron:build']).toContain('electron:build:validate');
    expect(rootPackage.scripts['electron:build:validate']).toBe(
      'cd apps/electron && bun run build:validate',
    );
  });

  test('Windows copies runtime content without desktop sources or a second Bun', () => {
    const runtime = ['package.json', 'dist/main.cjs', 'dist/bootstrap-preload.cjs',
      'dist/resources/pi-agent-server/pi-agent-server.exe',
      'dist/resources/agent-defaults/global-skills/example/SKILL.md',
      'dist/resources/agent-defaults/global-skills/example/scripts/tool.ts',
      'dist/resources/scripts/markitdown_cli.py'];
    expect(selectedFiles('win', [...runtime,
      'vendor/bun/bun.exe', 'src/main/index.ts', 'src/main/__tests__/index.test.ts',
      'electron-builder.yml', 'resources/icon.ico', 'dist/main.cjs.map',
      'dist/resources/dmg-background.tiff', 'dist/resources/bin/darwin-arm64/uv',
      'dist/resources/bin/linux-x64/uv', 'dist/resources/bin/win32-x64/uv.exe',
    ])).toEqual(runtime);
  });

  test('all platforms exclude build-only icons while keeping runtime scripts and native binaries', () => {
    for (const platform of ['mac', 'win', 'linux'] as const) {
      const runtime = ['dist/main.cjs', 'dist/resources/icon.png', 'dist/resources/icon.ico',
        'dist/resources/scripts/markitdown_cli.py', 'dist/resources/agent-defaults/global-skills/example/SKILL.md'];
      if (platform !== 'win') runtime.push('vendor/bun/bun');
      if (platform === 'mac') runtime.push('dist/resources/bin/darwin-arm64/uv');
      if (platform === 'linux') runtime.push('dist/resources/bin/linux-x64/uv');
      const otherPlatform = platform === 'mac' ? 'linux' : 'darwin';
      expect(selectedFiles(platform, [...runtime, 'src/main/index.ts', 'dist/main.cjs.map',
        'dist/resources/Assets.car', 'dist/resources/icon.icns', 'dist/resources/icon.icon/Assets/icon.png',
        `dist/resources/bin/${otherPlatform}-arm64/uv`, 'dist/resources/dmg-background.tiff',
      ])).toEqual(runtime);
    }
  });

  test('Electron locales cover the product catalog and English fallbacks on every platform', () => {
    const config = readBuilderConfig();
    for (const platform of ['mac', 'win', 'linux']) {
      const aliases: Record<string, string[]> = platform === 'mac'
        ? { en: ['en', 'en_GB'], 'zh-Hans': ['zh_CN'] }
        : { en: ['en-US', 'en-GB'], 'zh-Hans': ['zh-CN'] };
      const expected = SUPPORTED_LANGUAGE_CODES.flatMap(code => aliases[code] ?? [code]);
      expect((config[platform].electronLanguages ?? config.electronLanguages)?.slice().sort()).toEqual(expected.sort());
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

  test('does not include the component Playground in production renderer inputs', () => {
    const viteConfig = readRepoFile('apps/electron/vite.config.ts');

    expect(viteConfig).not.toMatch(/playground:\s*resolve\([^)]*playground\.html/);
  });
});
