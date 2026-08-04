// input: Temporary package build outputs without stale transitive native dependencies
// output: Regression coverage for Electron subprocess resource staging
// pos: Guards the packaging contract consumed by backend runtime path resolution

import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getBunCompileTarget,
  getPiAgentServerEntryName,
  getPiAgentServerBuildArgs,
} from './pi-agent-server.ts';
import { resolveBuildTargetFromEnv, stageSubprocessResources } from './resource-staging.ts';

const tempRoots: string[] = [];

function createTempRoot(): string {
  const root = join(tmpdir(), `craft-resource-staging-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
}

function writeFile(path: string, content = ''): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Electron subprocess resource staging', () => {
  test('resolves explicit release target from environment', () => {
    expect(resolveBuildTargetFromEnv({
      CRAFT_BUILD_PLATFORM: 'darwin',
      CRAFT_BUILD_ARCH: 'x64',
    })).toEqual({ platform: 'darwin', arch: 'x64' });
    expect(getPiAgentServerEntryName('darwin')).toBe('pi-agent-server');
    expect(getPiAgentServerEntryName('win32')).toBe('index.js');
    expect(getBunCompileTarget('darwin', 'arm64')).toBe('bun-darwin-arm64');
    expect(getBunCompileTarget('linux', 'x64')).toBe('bun-linux-x64-baseline');
    expect(getBunCompileTarget('win32', 'x64')).toBe('bun-windows-x64-baseline');
    const windowsArgs = getPiAgentServerBuildArgs({
      platform: 'win32',
      arch: 'x64',
      outputPath: 'index.js',
      compileExecutablePath: 'vendor/bun/bun.exe',
    });
    expect(windowsArgs).toContain('--target=bun');
    expect(windowsArgs).not.toContain('--compile');
    expect(windowsArgs).not.toContain('--compile-executable-path=vendor/bun/bun.exe');
    expect(getPiAgentServerBuildArgs({
      platform: 'darwin',
      arch: 'arm64',
      outputPath: 'pi-agent-server',
      compileExecutablePath: 'vendor/bun/bun',
    })).toContain('--compile-executable-path=vendor/bun/bun');
  });

  test('copies the native Pi subprocess without legacy runtime resources', () => {
    const rootDir = createTempRoot();
    const electronDir = join(rootDir, 'apps', 'electron');
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    writeFile(join(rootDir, 'packages', 'pi-agent-server', 'src', 'index.ts'), 'source');
    writeFile(join(rootDir, 'packages', 'pi-agent-server', 'dist', 'pi-agent-server'), 'pi');

    stageSubprocessResources({
      rootDir,
      electronDir,
      platform: 'darwin',
      arch: 'x64',
    });

    expect(existsSync(join(electronDir, 'resources', 'pi-agent-server', 'pi-agent-server'))).toBe(true);
    expect(existsSync(join(electronDir, 'resources', 'pi-agent-server', 'node_modules'))).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
