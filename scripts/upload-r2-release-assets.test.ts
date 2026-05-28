// input: Temporary release asset directories
// output: Regression checks for R2 release publishing preflight behavior
// pos: Prevents public download publishing from silently missing required artifacts

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { releaseAssetFiles, requiredPublicReleaseAssets } from "@craft-agent/shared/release-assets";

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
});
