// input: Public release download metadata
// output: Regression checks for landing-page download targets
// pos: Marketing app guard for platform download links

import { describe, expect, test } from "bun:test";

import { downloadOptions, latestReleaseUrl, repositoryUrl } from "../downloads";

describe("downloadOptions", () => {
  test("points every installer at the real Storyflow GitHub release assets with Chinese labels", () => {
    expect(repositoryUrl).toBe("https://github.com/JiuZhou-ailab/craft-agents-oss");
    expect(latestReleaseUrl).toBe(`${repositoryUrl}/releases/latest`);

    expect(downloadOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mac-arm64",
          label: "下载 Apple Silicon 版",
          fileName: "Storyflow-arm64.dmg",
          href: `${latestReleaseUrl}/download/Storyflow-arm64.dmg`,
        }),
        expect.objectContaining({
          id: "mac-x64",
          label: "下载 Intel Mac 版",
          fileName: "Storyflow-x64.dmg",
          href: `${latestReleaseUrl}/download/Storyflow-x64.dmg`,
        }),
        expect.objectContaining({
          id: "windows-x64",
          label: "下载 Windows 版",
          fileName: "Storyflow-x64.exe",
          href: `${latestReleaseUrl}/download/Storyflow-x64.exe`,
        }),
      ]),
    );

    expect(downloadOptions.every((option) => option.fileName.startsWith("Storyflow-"))).toBe(
      true,
    );
    expect(downloadOptions.every((option) => !option.href.includes("Craft-Agents"))).toBe(true);
  });
});
