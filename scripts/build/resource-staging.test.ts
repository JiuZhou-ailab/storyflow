// input: Temporary package build outputs and fake native dependencies
// output: Regression coverage for Electron subprocess resource staging
// pos: Guards the packaging contract consumed by backend runtime path resolution

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  });

  test('copies session and Pi subprocess bundles into Electron resources', () => {
    const rootDir = createTempRoot();
    const electronDir = join(rootDir, 'apps', 'electron');

    writeFile(join(rootDir, 'packages', 'session-mcp-server', 'dist', 'index.js'), 'session');
    writeFile(join(rootDir, 'packages', 'pi-agent-server', 'src', 'index.ts'), 'source');
    writeFile(join(rootDir, 'packages', 'pi-agent-server', 'dist', 'index.js'), 'pi');

    const koffiRoot = join(rootDir, 'node_modules', 'koffi');
    writeFile(join(koffiRoot, 'package.json'), '{"name":"koffi"}');
    writeFile(join(koffiRoot, 'index.js'), 'module.exports = {}');
    writeFile(join(koffiRoot, 'indirect.js'), 'module.exports = {}');
    writeFile(join(koffiRoot, 'index.d.ts'), 'export {};');
    writeFile(join(koffiRoot, 'lib', 'index.js'), 'module.exports = {}');
    writeFile(join(koffiRoot, 'build', 'koffi', 'darwin_x64', 'koffi.node'), 'native');

    stageSubprocessResources({
      rootDir,
      electronDir,
      platform: 'darwin',
      arch: 'x64',
    });

    expect(existsSync(join(electronDir, 'resources', 'session-mcp-server', 'index.js'))).toBe(true);
    expect(existsSync(join(electronDir, 'resources', 'pi-agent-server', 'index.js'))).toBe(true);
    expect(existsSync(join(
      electronDir,
      'resources',
      'pi-agent-server',
      'node_modules',
      'koffi',
      'build',
      'koffi',
      'darwin_x64',
      'koffi.node',
    ))).toBe(true);
  });
});
