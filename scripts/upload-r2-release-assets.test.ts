// input: Temporary release asset directories and release retention object keys
// output: Regression checks for R2 release publishing profiles and retention planning
// pos: Prevents public download publishing from silently missing or retaining wrong artifacts

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { releaseAssetFiles, requiredPublicReleaseAssets } from "@craft-agent/shared/release-assets";
import { planR2ReleaseRetention } from "./upload-r2-release-assets.ts";

const rootDir = join(import.meta.dir, "..");
const uploadScript = join(rootDir, "scripts", "upload-r2-release-assets.ts");

function makeAssetsDir(files: readonly string[] = requiredPublicReleaseAssets): string {
  const dir = mkdtempSync(join(tmpdir(), "storyflow-r2-assets-"));
  mkdirSync(dir, { recursive: true });
  for (const fileName of files) {
    writeFileSync(join(dir, fileName), `${fileName}\n`);
  }
  return dir;
}

function runUpload(args: string[], assetsDir: string) {
  return spawnSync("bun", ["run", uploadScript, "--tag=v0.9.12", "--assets-dir", assetsDir, ...args], {
    cwd: rootDir,
    encoding: "utf8",
    env: {
      ...process.env,
      STORYFLOW_R2_BUCKET: "storyflow-downloads",
      STORYFLOW_R2_PUBLIC_BASE_URL: "https://story-storage.zjding.com",
    },
  });
}

describe("upload-r2-release-assets", () => {
  test("dry-runs versioned release uploads and stable latest uploads for required release assets", () => {
    const assetsDir = makeAssetsDir();
    const result = runUpload(["--dry-run"], assetsDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `https://story-storage.zjding.com/releases/v0.9.12/${releaseAssetFiles.macArm64Dmg}`,
    );
    expect(result.stdout).toContain(
      "https://story-storage.zjding.com/releases/v0.9.12/Storyflow-0.9.12-arm64.dmg",
    );
    expect(result.stdout).toContain(`https://story-storage.zjding.com/latest/${releaseAssetFiles.macArm64Dmg}`);
    expect(result.stdout).not.toContain("https://story-storage.zjding.com/latest/Storyflow-0.9.12-arm64.dmg");
    expect(result.stdout).toContain(`https://story-storage.zjding.com/latest/${releaseAssetFiles.macManifest}`);
    expect(result.stdout).toContain("Published 9 asset(s)");
  });

  test("fails before upload when a required public asset is missing", () => {
    const assetsDir = makeAssetsDir(
      requiredPublicReleaseAssets.filter((fileName) => fileName !== releaseAssetFiles.macManifest),
    );
    const result = runUpload(["--dry-run"], assetsDir);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`Missing required release asset(s): ${releaseAssetFiles.macManifest}`);
  });

  test("supports a Windows-only release profile without macOS artifacts", () => {
    const assetsDir = makeAssetsDir([
      releaseAssetFiles.windowsX64Exe,
      `${releaseAssetFiles.windowsX64Exe}.blockmap`,
      releaseAssetFiles.windowsManifest,
    ]);
    const result = runUpload(["--dry-run", "--profile=windows"], assetsDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`https://story-storage.zjding.com/releases/v0.9.12/${releaseAssetFiles.windowsX64Exe}`);
    expect(result.stdout).toContain(`https://story-storage.zjding.com/latest/${releaseAssetFiles.windowsManifest}`);
    expect(result.stdout).not.toContain(releaseAssetFiles.macArm64Dmg);
    expect(result.stdout).toContain("Published 3 asset(s)");
  });

  test("plans R2 release retention by keeping the newest release tags", () => {
    const plan = planR2ReleaseRetention({
      objectKeys: [
        "latest/Storyflow-x64.exe",
        "releases/v0.9.8/Storyflow-x64.exe",
        "releases/v0.9.8/latest.yml",
        "releases/v0.9.10/Storyflow-x64.exe",
        "releases/v0.9.9/Storyflow-x64.exe",
        "releases/v0.9.11/Storyflow-x64.exe",
      ],
      releasePrefix: "releases",
      retainReleases: 2,
    });

    expect(plan.keptTags).toEqual(["v0.9.11", "v0.9.10"]);
    expect(plan.deletedTags).toEqual(["v0.9.9", "v0.9.8"]);
    expect(plan.deleteKeys).toHaveLength(3);
    expect(plan.deleteKeys).toContain("releases/v0.9.8/Storyflow-x64.exe");
    expect(plan.deleteKeys).toContain("releases/v0.9.8/latest.yml");
    expect(plan.deleteKeys).toContain("releases/v0.9.9/Storyflow-x64.exe");
  });
});
