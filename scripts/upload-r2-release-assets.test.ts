// input: Temporary release asset directories
// output: Regression checks for R2 release publishing preflight behavior
// pos: Prevents public download publishing from silently missing required artifacts

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..");
const uploadScript = join(rootDir, "scripts", "upload-r2-release-assets.ts");

const requiredFiles = [
  "Storyflow-arm64.dmg",
  "Storyflow-x64.dmg",
  "Storyflow-arm64.zip",
  "Storyflow-x64.zip",
  "Storyflow-x64.exe",
  "latest-mac.yml",
  "latest.yml",
  "install-app.sh",
  "install-app.ps1",
] as const;

function makeAssetsDir(files = requiredFiles): string {
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
      STORYFLOW_R2_ENDPOINT: "https://account-id.r2.cloudflarestorage.com",
      STORYFLOW_R2_ACCESS_KEY_ID: "test-access-key",
      STORYFLOW_R2_SECRET_ACCESS_KEY: "test-secret-key",
      STORYFLOW_R2_PUBLIC_BASE_URL: "https://story.zjding.com",
    },
  });
}

describe("upload-r2-release-assets", () => {
  test("dry-runs versioned and latest uploads for required release assets", () => {
    const assetsDir = makeAssetsDir();
    const result = runUpload(["--dry-run"], assetsDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "https://story.zjding.com/releases/v0.9.12/Storyflow-arm64.dmg",
    );
    expect(result.stdout).toContain("https://story.zjding.com/latest/Storyflow-arm64.dmg");
    expect(result.stdout).toContain("https://story.zjding.com/latest/latest-mac.yml");
    expect(result.stdout).toContain("Published 9 asset(s)");
  });

  test("fails before upload when a required public asset is missing", () => {
    const assetsDir = makeAssetsDir(
      requiredFiles.filter((fileName) => fileName !== "latest-mac.yml"),
    );
    const result = runUpload(["--dry-run"], assetsDir);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Missing required release asset(s): latest-mac.yml");
  });
});
