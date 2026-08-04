// input: Built subprocess bundles, target platform metadata, and Electron app paths
// output: Electron resources containing subprocess entrypoints and native runtime dependencies
// pos: Packaging contract layer between build outputs and backend runtime path resolution

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  copyPiAgentServer,
  type Arch,
  type BuildConfig,
  type Platform,
} from './common.ts';
import { getPiAgentServerBinaryName } from './pi-agent-server.ts';

export interface SubprocessResourceStageConfig {
  rootDir: string;
  electronDir: string;
  platform: Platform;
  arch: Arch;
}

export function resolveBuildTargetFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): { platform: Platform; arch: Arch } {
  return {
    platform: parsePlatform(env.CRAFT_BUILD_PLATFORM || process.platform),
    arch: parseArch(env.CRAFT_BUILD_ARCH || process.arch),
  };
}

function parsePlatform(value: string): Platform {
  if (value === 'darwin' || value === 'win32' || value === 'linux') return value;
  throw new Error(`Unsupported Electron build platform: ${value}`);
}

function parseArch(value: string): Arch {
  if (value === 'x64' || value === 'arm64') return value;
  throw new Error(`Unsupported Electron build architecture: ${value}`);
}

export function stageSubprocessResources(config: SubprocessResourceStageConfig): void {
  const buildConfig: BuildConfig = {
    ...config,
    upload: false,
    uploadLatest: false,
    uploadScript: false,
  };

  const piDest = join(config.electronDir, 'resources', 'pi-agent-server');

  rmSync(piDest, { recursive: true, force: true });

  copyPiAgentServer(buildConfig);

  const piPackagePresent = existsSync(join(config.rootDir, 'packages', 'pi-agent-server', 'src'));
  const piEntry = join(piDest, getPiAgentServerBinaryName(config.platform));
  if (piPackagePresent && !existsSync(piEntry)) {
    throw new Error(`Pi agent server was not staged at ${piEntry}`);
  }
}
