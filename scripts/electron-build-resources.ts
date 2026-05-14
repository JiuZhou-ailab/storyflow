// input: Electron static resources and built subprocess bundles
// output: dist/resources tree consumed by Electron main process at runtime
// pos: Root resource build step for desktop packaging and local Electron builds

import { existsSync, cpSync } from "fs";
import { join } from "path";
import { resolveBuildTargetFromEnv, stageSubprocessResources } from "./build/resource-staging.ts";

const ROOT_DIR = join(import.meta.dir, "..");
const ELECTRON_DIR = join(ROOT_DIR, "apps/electron");
const target = resolveBuildTargetFromEnv();

stageSubprocessResources({
  rootDir: ROOT_DIR,
  electronDir: ELECTRON_DIR,
  platform: target.platform,
  arch: target.arch,
});

const srcDir = join(ELECTRON_DIR, "resources");
const destDir = join(ELECTRON_DIR, "dist/resources");

if (existsSync(srcDir)) {
  cpSync(srcDir, destDir, { recursive: true, force: true });
  console.log("📦 Copied resources to dist");
} else {
  console.log("⚠️ No resources directory found");
}
