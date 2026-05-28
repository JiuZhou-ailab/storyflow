// input: Packaged and development Electron path metadata
// output: Regression coverage for CLI/runtime resource locations
// pos: Guards packaged resource-root decisions used before the main process starts agents

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { resolveElectronRuntimePaths } from '../runtime-paths';

describe('resolveElectronRuntimePaths', () => {
  test('uses app/dist/resources as the packaged CLI resource root', () => {
    const paths = resolveElectronRuntimePaths({
      isPackaged: true,
      appPath: '/Applications/Storyflow.app/Contents/Resources/app',
      resourcesPath: '/Applications/Storyflow.app/Contents/Resources',
      dirname: '/Applications/Storyflow.app/Contents/Resources/app/dist',
      cwd: '/repo',
      platform: 'darwin',
      arch: 'arm64',
    });

    const resourcesBase = '/Applications/Storyflow.app/Contents/Resources/app/dist';
    expect(paths.appRoot).toBe('/Applications/Storyflow.app/Contents/Resources/app');
    expect(paths.resourcesBase).toBe(resourcesBase);
    expect(paths.uvBinary).toBe(join(resourcesBase, 'resources', 'bin', 'darwin-arm64', 'uv'));
    expect(paths.binDir).toBe(join(resourcesBase, 'resources', 'bin'));
    expect(paths.scriptsDir).toBe(join(resourcesBase, 'resources', 'scripts'));
    expect(paths.bunBinary).toBe('/Applications/Storyflow.app/Contents/Resources/app/vendor/bun/bun');
    expect(paths.commandsDocPath).toBe(join(resourcesBase, 'resources', 'docs', 'craft-cli.md'));
  });

  test('keeps Windows packaged Bun in process resources while app resources stay under app/dist', () => {
    const paths = resolveElectronRuntimePaths({
      isPackaged: true,
      appPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\Storyflow\\resources\\app',
      resourcesPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\Storyflow\\resources',
      dirname: 'C:\\Users\\me\\AppData\\Local\\Programs\\Storyflow\\resources\\app\\dist',
      cwd: 'C:\\repo',
      platform: 'win32',
      arch: 'x64',
    });

    expect(paths.resourcesBase).toBe('C:\\Users\\me\\AppData\\Local\\Programs\\Storyflow\\resources\\app\\dist');
    expect(paths.uvBinary).toBe('C:\\Users\\me\\AppData\\Local\\Programs\\Storyflow\\resources\\app\\dist\\resources\\bin\\win32-x64\\uv.exe');
    expect(paths.bunBinary).toBe('C:\\Users\\me\\AppData\\Local\\Programs\\Storyflow\\resources\\vendor\\bun\\bun.exe');
  });

  test('keeps development resources at the Electron app root', () => {
    const paths = resolveElectronRuntimePaths({
      isPackaged: false,
      appPath: '/unused',
      dirname: '/repo/apps/electron/dist',
      cwd: '/repo',
      platform: 'darwin',
      arch: 'arm64',
    });

    expect(paths.appRoot).toBe('/repo');
    expect(paths.resourcesBase).toBe('/repo/apps/electron');
    expect(paths.uvBinary).toBe('/repo/apps/electron/resources/bin/darwin-arm64/uv');
    expect(paths.bunBinary).toBe('/repo/apps/electron/vendor/bun/bun');
    expect(paths.commandsDocPath).toBe('/repo/apps/electron/resources/docs/craft-cli.md');
  });
});
