// input: Public release asset contract
// output: Regression checks for Storyflow release asset naming
// pos: Guards the shared release asset contract used by publishing and downloads

import { describe, expect, test } from "bun:test";

import {
  publicInstallerAssets,
  releaseAssetFiles,
  requiredPublicReleaseAssets,
  versionedInstallerFileName,
  updateManifestFiles,
} from "./release-assets.ts";

describe("release asset contract", () => {
  test("lists every public release asset exactly once", () => {
    expect(requiredPublicReleaseAssets).toEqual([
      "Storyflow-arm64.dmg",
      "Storyflow-x64.dmg",
      "Storyflow-arm64.zip",
      "Storyflow-x64.zip",
      "Storyflow-x64.exe",
      "latest-mac.yml",
      "latest.yml",
      "install-app.sh",
      "install-app.ps1",
    ]);
    expect(new Set(requiredPublicReleaseAssets).size).toBe(requiredPublicReleaseAssets.length);
  });

  test("keeps installer downloads and updater manifests derived from release files", () => {
    expect(publicInstallerAssets.map((asset) => asset.fileName)).toEqual([
      releaseAssetFiles.macArm64Dmg,
      releaseAssetFiles.macX64Dmg,
      releaseAssetFiles.windowsX64Exe,
    ]);
    expect(updateManifestFiles).toEqual({
      macOS: releaseAssetFiles.macManifest,
      Windows: releaseAssetFiles.windowsManifest,
    });
  });

  test("derives versioned installer download names without changing release asset names", () => {
    expect(versionedInstallerFileName(releaseAssetFiles.macArm64Dmg, "v0.9.17")).toBe(
      "Storyflow-0.9.17-arm64.dmg",
    );
    expect(versionedInstallerFileName(releaseAssetFiles.macX64Dmg, "0.9.17")).toBe(
      "Storyflow-0.9.17-x64.dmg",
    );
    expect(versionedInstallerFileName(releaseAssetFiles.windowsX64Exe, "v0.9.17")).toBe(
      "Storyflow-0.9.17-x64.exe",
    );
  });
});
