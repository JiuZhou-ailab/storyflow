// input: Release build target flags and platform packaging scripts
// output: A packaged Electron artifact for the requested platform and architecture
// pos: Root build dispatcher that keeps package.json from bypassing runtime staging

import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { downloadUv, type BuildConfig } from "./build/common.ts";

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
    "The dispatcher calls the platform packaging scripts under apps/electron/scripts",
    "so required runtime assets are staged before electron-builder runs.",
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
    throw new Error("Windows upload is not wired in build-win.ps1. Build locally without --upload.");
  }

  if (options.upload && !existsSync(join(rootDir, "scripts", "upload.ts"))) {
    throw new Error("Upload requested, but scripts/upload.ts is missing. Build locally without --upload.");
  }

  return options;
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd: electronDir,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with code ${result.status ?? "unknown"}`);
  }
}

function buildArgs(options: BuildOptions): string[] {
  const args = [options.arch!];
  if (options.upload) args.push("--upload");
  if (options.latest) args.push("--latest");
  if (options.script) args.push("--script");
  return args;
}

async function ensureBundledUv(options: BuildOptions): Promise<void> {
  const config: BuildConfig = {
    platform: options.platform,
    arch: options.arch!,
    upload: options.upload,
    uploadLatest: options.latest,
    uploadScript: options.script,
    rootDir,
    electronDir,
  };

  await downloadUv(config);
}

const options = parseOptions(Bun.argv.slice(2));

await ensureBundledUv(options);

switch (options.platform) {
  case "darwin":
    run("bash", [join(electronDir, "scripts", "build-dmg.sh"), ...buildArgs(options)]);
    break;
  case "linux":
    run("bash", [join(electronDir, "scripts", "build-linux.sh"), ...buildArgs(options)]);
    break;
  case "win32":
    run("powershell", [
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(electronDir, "scripts", "build-win.ps1"),
    ]);
    break;
}
