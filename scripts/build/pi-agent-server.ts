// input: Repository root and target platform/architecture
// output: A self-contained Pi agent server executable using Pi's native binary extension loader
// pos: Canonical cross-platform build entrypoint for the Pi subprocess

import { spawn } from 'bun';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type PiServerPlatform = 'darwin' | 'win32' | 'linux';
export type PiServerArch = 'x64' | 'arm64';

export function getPiAgentServerBinaryName(platform: PiServerPlatform): string {
  return platform === 'win32' ? 'pi-agent-server.exe' : 'pi-agent-server';
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
    getPiAgentServerBinaryName(platform),
  );
}

export function getBunCompileTarget(platform: PiServerPlatform, arch: PiServerArch): string {
  const target = `bun-${platform === 'win32' ? 'windows' : platform}-${arch}`;
  return arch === 'x64' && platform !== 'darwin' ? `${target}-baseline` : target;
}

export function getPiAgentServerCompileArgs(options: {
  platform: PiServerPlatform;
  arch: PiServerArch;
  outputPath: string;
  compileExecutablePath?: string;
}): string[] {
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

export async function buildPiAgentServerBinary(options: {
  rootDir: string;
  platform?: PiServerPlatform;
  arch?: PiServerArch;
  compileExecutablePath?: string;
}): Promise<string> {
  const platform = options.platform ?? hostPlatform();
  const arch = options.arch ?? hostArch();
  const packageDir = join(options.rootDir, 'packages', 'pi-agent-server');
  const outputPath = getPiAgentServerOutputPath(options.rootDir, platform);
  mkdirSync(join(packageDir, 'dist'), { recursive: true });

  const buildProcess = spawn({
    cmd: getPiAgentServerCompileArgs({
      platform,
      arch,
      outputPath,
      compileExecutablePath: options.compileExecutablePath,
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
  await buildPiAgentServerBinary({
    rootDir: join(import.meta.dir, '..', '..'),
    platform,
    arch,
    compileExecutablePath: process.env.CRAFT_BUN,
  });
}
