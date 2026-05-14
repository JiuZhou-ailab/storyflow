// input: Release target flags, workspace validation scripts, and package builder
// output: Validated local release artifact or explicit failure before packaging/upload
// pos: Root release gate combining version, CI validation, and runtime-staged packaging

import { spawnSync } from "child_process";

function usage(): string {
  return [
    "Usage: bun run scripts/release.ts [--platform=darwin|linux|win32] [--arch=arm64|x64] [--upload] [--latest] [--script]",
    "",
    "Runs version alignment, validate:ci, then the runtime-staged package builder.",
    "Upload flags are passed through to scripts/build.ts.",
  ].join("\n");
}

function run(args: string[]): void {
  const result = spawnSync("bun", args, {
    cwd: joinRoot(),
    env: process.env,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`bun ${args.join(" ")} exited with code ${result.status ?? "unknown"}`);
  }
}

function joinRoot(): string {
  return new URL("..", import.meta.url).pathname;
}

const buildArgs = Bun.argv.slice(2);

if (buildArgs.includes("-h") || buildArgs.includes("--help")) {
  console.log(usage());
  process.exit(0);
}

run(["run", "check-version"]);
run(["run", "validate:ci"]);
run(["run", "scripts/build.ts", ...buildArgs]);
