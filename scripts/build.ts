// input: Release build target flags and platform packaging scripts
// output: A packaged Electron artifact for the requested platform and architecture
// pos: Root build dispatcher that keeps package.json from bypassing runtime staging

import { existsSync } from "fs";
import { join } from "path";
import {
  buildElectronApp,
  buildMcpServers,
  cleanBuildArtifacts,
  copyInterceptor,
  copyRipgrep,
  copySDK,
  createManifest,
  downloadBun,
  downloadUv,
  installDependencies,
  loadEnvFile,
  uploadToS3,
  verifyMcpServersExist,
  verifySDKCopy,
  type BuildConfig,
} from "./build/common.ts";
import { packageDarwin } from "./build/darwin.ts";
import { packageLinux } from "./build/linux.ts";
import { stageSubprocessResources } from "./build/resource-staging.ts";
import { buildElectronAppWindows, packageWindows } from "./build/win32.ts";

type BuildPlatform = "darwin" | "linux" | "win32";
type BuildArch = "arm64" | "x64";

interface BuildOptions {
  platform: BuildPlatform;
  arch?: BuildArch;
  upload: boolean;
  latest: boolean;
  script: boolean;
}

const rootDir = join(import.meta.dir, "..");
const electronDir = join(rootDir, "apps", "electron");

function usage(): string {
  return [
    "Usage: bun run scripts/build.ts [--platform=darwin|linux|win32] [--arch=arm64|x64] [--upload] [--latest] [--script]",
    "",
    "Defaults:",
    "  --platform uses the current host platform.",
    "  --arch uses arm64 on darwin, x64 on linux/win32.",
    "",
    "The dispatcher stages runtime assets before electron-builder runs.",
  ].join("\n");
}

function parsePlatform(value: string): BuildPlatform {
  if (value === "darwin" || value === "linux" || value === "win32") return value;
  throw new Error(`Unsupported platform: ${value}`);
}

function parseArch(value: string): BuildArch {
  if (value === "arm64" || value === "x64") return value;
  throw new Error(`Unsupported arch: ${value}`);
}

function parseOptions(args: string[]): BuildOptions {
  const options: BuildOptions = {
    platform: parsePlatform(process.platform),
    upload: false,
    latest: false,
    script: false,
  };

  for (const arg of args) {
    if (arg === "-h" || arg === "--help") {
      console.log(usage());
      process.exit(0);
    }
    if (arg.startsWith("--platform=")) {
      options.platform = parsePlatform(arg.slice("--platform=".length));
      continue;
    }
    if (arg.startsWith("--arch=")) {
      options.arch = parseArch(arg.slice("--arch=".length));
      continue;
    }
    if (arg === "--upload") {
      options.upload = true;
      continue;
    }
    if (arg === "--latest") {
      options.latest = true;
      continue;
    }
    if (arg === "--script") {
      options.script = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.arch) {
    options.arch = options.platform === "darwin" ? "arm64" : "x64";
  }

  if (options.platform === "win32" && options.arch !== "x64") {
    throw new Error("Windows packaging currently supports x64 only.");
  }

  if ((options.latest || options.script) && !options.upload) {
    throw new Error("--latest and --script require --upload.");
  }

  if (options.platform === "win32" && options.upload) {
    throw new Error("Windows upload is not wired. Build locally without --upload.");
  }

  if (options.upload && !existsSync(join(rootDir, "scripts", "upload.ts"))) {
    throw new Error("Upload requested, but scripts/upload.ts is missing. Build locally without --upload.");
  }

  return options;
}

function createBuildConfig(options: BuildOptions): BuildConfig {
  return {
    platform: options.platform,
    arch: options.arch!,
    upload: options.upload,
    uploadLatest: options.latest,
    uploadScript: options.script,
    rootDir,
    electronDir,
  };
}

async function prepareRuntime(config: BuildConfig): Promise<void> {
  await loadEnvFile(config);
  cleanBuildArtifacts(config);
  await installDependencies(config);
  await downloadBun(config);
  await downloadUv(config);
  copySDK(config);
  verifySDKCopy(config);
  copyRipgrep(config);
  copyInterceptor(config);
  buildMcpServers(config);
}

async function buildPackage(config: BuildConfig): Promise<void> {
  process.env.CRAFT_BUILD_PLATFORM = config.platform;
  process.env.CRAFT_BUILD_ARCH = config.arch;

  if (config.platform === "win32") {
    stageSubprocessResources(config);
    await buildElectronAppWindows(config);
    await packageWindows(config);
  } else {
    await buildElectronApp(config);
    verifyMcpServersExist(config);
    if (config.platform === "darwin") {
      await packageDarwin(config);
    } else {
      await packageLinux(config);
    }
  }

  await createManifest(config);
  await uploadToS3(config);
}

const options = parseOptions(Bun.argv.slice(2));
const config = createBuildConfig(options);

await prepareRuntime(config);
await buildPackage(config);
