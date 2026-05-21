// input: Public release download metadata
// output: Regression checks for landing-page download targets
// pos: Marketing app guard for platform download links

import { describe, expect, test } from "bun:test";

import {
  defaultDownloadBaseUrl,
  downloadBaseUrl,
  downloadOptions,
  normalizeDownloadBaseUrl,
  updateManifestUrls,
} from "../downloads";

describe("downloadOptions", () => {
  test("points every installer at the public R2 release assets with Chinese labels", () => {
    expect(defaultDownloadBaseUrl).toBe("https://download.storyflow.ai/latest");
    expect(downloadBaseUrl).toBe(defaultDownloadBaseUrl);

    expect(downloadOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mac-arm64",
          label: "下载 Apple Silicon 版",
          fileName: "Storyflow-arm64.dmg",
          href: `${downloadBaseUrl}/Storyflow-arm64.dmg`,
        }),
        expect.objectContaining({
          id: "mac-x64",
          label: "下载 Intel Mac 版",
          fileName: "Storyflow-x64.dmg",
          href: `${downloadBaseUrl}/Storyflow-x64.dmg`,
        }),
        expect.objectContaining({
          id: "windows-x64",
          label: "下载 Windows 版",
          fileName: "Storyflow-x64.exe",
          href: `${downloadBaseUrl}/Storyflow-x64.exe`,
        }),
      ]),
    );

    expect(downloadOptions.every((option) => option.fileName.startsWith("Storyflow-"))).toBe(
      true,
    );
    expect(downloadOptions.every((option) => !option.href.includes("Craft-Agents"))).toBe(true);
    expect(downloadOptions.every((option) => !option.href.includes("github.com"))).toBe(true);
  });

  test("normalizes configured R2 download bases", () => {
    expect(normalizeDownloadBaseUrl(" https://cdn.example.com/releases/latest/// ")).toBe(
      "https://cdn.example.com/releases/latest",
    );
    expect(normalizeDownloadBaseUrl("   ")).toBe(defaultDownloadBaseUrl);
  });

  test("exposes public update manifests next to installer assets", () => {
    expect(updateManifestUrls).toEqual({
      macOS: `${downloadBaseUrl}/latest-mac.yml`,
      Windows: `${downloadBaseUrl}/latest.yml`,
    });
  });
});
