// input: Repository root and target platform/architecture
// output: A Pi agent server entrypoint using the packaged Bun runtime on Windows and a native executable elsewhere
// pos: Canonical cross-platform build entrypoint for the Pi subprocess

import { spawn } from 'bun';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type PiServerPlatform = 'darwin' | 'win32' | 'linux';
export type PiServerArch = 'x64' | 'arm64';

export function getPiAgentServerEntryName(platform: PiServerPlatform): string {
  return platform === 'win32' ? 'index.js' : 'pi-agent-server';
}

export function getPiAgentServerOutputPath(
  rootDir: string,
  platform: PiServerPlatform,
): string {
  return join(
    rootDir,
    'packages',
    'pi-agent-server',
    'dist',
    getPiAgentServerEntryName(platform),
  );
}

export function getBunCompileTarget(platform: PiServerPlatform, arch: PiServerArch): string {
  const target = `bun-${platform === 'win32' ? 'windows' : platform}-${arch}`;
  return arch === 'x64' && platform !== 'darwin' ? `${target}-baseline` : target;
}

export function getPiAgentServerBuildArgs(options: {
  platform: PiServerPlatform;
  arch: PiServerArch;
  outputPath: string;
  compileExecutablePath?: string;
}): string[] {
  if (options.platform === 'win32') {
    return [
      'bun',
      'build',
      'src/index.ts',
      '--minify',
      '--target=bun',
      `--outfile=${options.outputPath}`,
    ];
  }

  return [
    'bun',
    'build',
    'src/index.ts',
    '--compile',
    '--minify',
    `--target=${getBunCompileTarget(options.platform, options.arch)}`,
    ...(options.compileExecutablePath
      ? [`--compile-executable-path=${options.compileExecutablePath}`]
      : []),
    `--outfile=${options.outputPath}`,
  ];
}

function hostPlatform(): PiServerPlatform {
  if (process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux') {
    return process.platform;
  }
  throw new Error(`Unsupported Pi agent server platform: ${process.platform}`);
}

function hostArch(): PiServerArch {
  if (process.arch === 'x64' || process.arch === 'arm64') return process.arch;
  throw new Error(`Unsupported Pi agent server architecture: ${process.arch}`);
}

export async function buildPiAgentServerEntry(options: {
  rootDir: string;
  platform?: PiServerPlatform;
  arch?: PiServerArch;
  compileExecutablePath?: string;
}): Promise<string> {
  const platform = options.platform ?? hostPlatform();
  const arch = options.arch ?? hostArch();
  const packageDir = join(options.rootDir, 'packages', 'pi-agent-server');
  const outputPath = getPiAgentServerOutputPath(options.rootDir, platform);
  const bundledBunPath = join(
    options.rootDir,
    'apps',
    'electron',
    'vendor',
    'bun',
    platform === 'win32' ? 'bun.exe' : 'bun',
  );
  mkdirSync(join(packageDir, 'dist'), { recursive: true });

  const buildProcess = spawn({
    cmd: getPiAgentServerBuildArgs({
      platform,
      arch,
      outputPath,
      compileExecutablePath: options.compileExecutablePath
        ?? (existsSync(bundledBunPath) ? bundledBunPath : undefined),
    }),
    cwd: packageDir,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await buildProcess.exited;
  if (exitCode !== 0) {
    throw new Error(`Pi agent server build failed with exit code ${exitCode}`);
  }
  return outputPath;
}

if (import.meta.main) {
  const platform = (process.env.CRAFT_BUILD_PLATFORM || hostPlatform()) as PiServerPlatform;
  const arch = (process.env.CRAFT_BUILD_ARCH || hostArch()) as PiServerArch;
  await buildPiAgentServerEntry({
    rootDir: join(import.meta.dir, '..', '..'),
    platform,
    arch,
    compileExecutablePath: process.env.CRAFT_BUN,
  });
}
