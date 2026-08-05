// input: Electron host runtime paths, packaged resources, and local dev filesystem
// output: Resolved backend executable, server, and tooling paths
// pos: Backend runtime path resolver shared by desktop and server startup

import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import type { BackendHostRuntimeContext } from '../types.ts';

export interface ResolvedBackendRuntimePaths {
  piServerPath?: string;
  nodeRuntimePath?: string;
  bundledRuntimePath?: string;
}

export interface ResolvedBackendHostTooling {
  ripgrepPath?: string;
}

function firstExistingPath(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Walk up from `base` checking `join(ancestor, relativePath)` at each level.
 * Stops after `maxLevels` ancestors or when hitting the filesystem root.
 */
function resolveUpwards(base: string, relativePath: string, maxLevels = 4): string | undefined {
  let dir = resolve(base);
  for (let i = 0; i <= maxLevels; i++) {
    const candidate = join(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return undefined;
}

function resolveBundledRuntimePath(hostRuntime: BackendHostRuntimeContext): string | undefined {
  const bunBinary = process.platform === 'win32' ? 'bun.exe' : 'bun';
  const bunBasePaths = [hostRuntime.resourcesPath, hostRuntime.appRootPath];
  const bundledBun = firstExistingPath(
    bunBasePaths
      .filter((basePath): basePath is string => !!basePath)
      .map(basePath => join(basePath, 'vendor', 'bun', bunBinary)),
  );
  if (bundledBun) return bundledBun;

  // Non-packaged (headless server, dev mode): fall back to system bun via PATH.
  // Packaged apps must ship their own bundled bun — never resolve from PATH
  // to avoid picking up an incompatible system install.
  if (!hostRuntime.isPackaged) {
    try {
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      const systemBun = execFileSync(whichCmd, ['bun'], { encoding: 'utf-8' }).trim();
      if (systemBun && existsSync(systemBun)) return systemBun;
    } catch { /* system bun not found */ }
  }
  return undefined;
}

function resolveServerPath(
  hostRuntime: BackendHostRuntimeContext,
  serverName: string,
  entryNames: readonly string[] = ['index.js'],
): string | undefined {
  if (hostRuntime.isPackaged) {
    return firstExistingPath(
      ['dist/resources', 'resources'].flatMap(resourceRoot =>
        entryNames.map(entryName =>
          join(hostRuntime.appRootPath, resourceRoot, serverName, entryName),
        ),
      ),
    );
  }
  for (const entryName of entryNames) {
    const resolved = resolveUpwards(
      hostRuntime.appRootPath,
      join('packages', serverName, 'dist', entryName),
    );
    if (resolved) return resolved;
  }
  return undefined;
}

/**
 * Locate the ripgrep binary used by the host search service.
 */
function resolveRipgrepPath(hostRuntime: BackendHostRuntimeContext): string | undefined {
  const binaryName = process.platform === 'win32' ? 'rg.exe' : 'rg';
  const ripgrepPaths = [
    join('node_modules', '@vscode', 'ripgrep-binary', 'bin', binaryName),
    join('node_modules', '@vscode', `ripgrep-${process.platform}-${process.arch}`, 'bin', binaryName),
    // Backward compatibility for packages produced with @vscode/ripgrep 1.17.
    join('node_modules', '@vscode', 'ripgrep', 'bin', binaryName),
  ];

  if (hostRuntime.isPackaged) {
    const packaged = firstExistingPath(ripgrepPaths.map(path => join(hostRuntime.appRootPath, path)));
    if (packaged) return packaged;
  }

  for (const path of ripgrepPaths) {
    const fromHostRoot = resolveUpwards(hostRuntime.appRootPath, path, 10);
    if (fromHostRoot) return fromHostRoot;
  }
  for (const path of ripgrepPaths) {
    const cwdFallback = join(process.cwd(), path);
    if (existsSync(cwdFallback)) return cwdFallback;
  }

  // Non-packaged (headless server, dev mode): fall back to system rg via PATH.
  // Packaged apps must use vendored binary only — never resolve from PATH
  // to avoid picking up an incompatible system install.
  if (!hostRuntime.isPackaged) {
    try {
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      const systemRg = execFileSync(whichCmd, ['rg'], { encoding: 'utf-8' }).trim();
      if (systemRg && existsSync(systemRg)) return systemRg;
    } catch { /* system rg not found */ }
  }

  return undefined;
}

export function resolveBackendRuntimePaths(hostRuntime: BackendHostRuntimeContext): ResolvedBackendRuntimePaths {
  const bundledRuntimePath = hostRuntime.nodeRuntimePath || resolveBundledRuntimePath(hostRuntime);
  const piBinary = process.platform === 'win32' ? 'pi-agent-server.exe' : 'pi-agent-server';

  return {
    piServerPath: resolveServerPath(hostRuntime, 'pi-agent-server', [piBinary, 'index.js']),
    nodeRuntimePath: hostRuntime.nodeRuntimePath || bundledRuntimePath || process.execPath,
    bundledRuntimePath,
  };
}

export function resolveBackendHostTooling(hostRuntime: BackendHostRuntimeContext): ResolvedBackendHostTooling {
  return {
    ripgrepPath: resolveRipgrepPath(hostRuntime),
  };
}
