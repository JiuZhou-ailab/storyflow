// input: Public release download metadata
// output: Regression checks for release download targets and landing copy
// pos: Marketing app guard for release metadata and the public landing page

import { describe, expect, test } from "bun:test";
import {
  publicInstallerAssets,
  releaseAssetFiles,
  updateManifestFiles,
} from "@storyflow/release-assets";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { App } from "../App";

import {
  defaultDownloadBaseUrl,
  downloadBaseUrl,
  downloadOptions,
  normalizeDownloadBaseUrl,
  updateManifestUrls,
} from "../downloads";

describe("downloadOptions", () => {
  test("points every installer at the public R2 release assets with Chinese labels", () => {
    expect(defaultDownloadBaseUrl).toBe("https://story.zjding.com/latest");
    expect(downloadBaseUrl).toBe(defaultDownloadBaseUrl);

    expect(downloadOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mac-arm64",
          label: "下载 Apple Silicon 版",
          fileName: releaseAssetFiles.macArm64Dmg,
          href: `${downloadBaseUrl}/${releaseAssetFiles.macArm64Dmg}`,
        }),
        expect.objectContaining({
          id: "mac-x64",
          label: "下载 Intel Mac 版",
          fileName: releaseAssetFiles.macX64Dmg,
          href: `${downloadBaseUrl}/${releaseAssetFiles.macX64Dmg}`,
        }),
        expect.objectContaining({
          id: "windows-x64",
          label: "下载 Windows 版",
          fileName: releaseAssetFiles.windowsX64Exe,
          href: `${downloadBaseUrl}/${releaseAssetFiles.windowsX64Exe}`,
        }),
      ]),
    );
    expect(downloadOptions.map((option) => option.fileName)).toEqual(
      publicInstallerAssets.map((asset) => asset.fileName),
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
      macOS: `${downloadBaseUrl}/${updateManifestFiles.macOS}`,
      Windows: `${downloadBaseUrl}/${updateManifestFiles.Windows}`,
    });
  });

  test("renders the Storyflow desktop landing page for writers", () => {
    const html = renderToStaticMarkup(createElement(App));

    expect(html).toContain("Storyflow");
    expect(html).toContain("写作者的本地 AI 工作台");
    expect(html).toContain("下载 Storyflow 桌面版");
    expect(html).toContain('href="#how-it-works-diagram"');
    expect(html).toContain('id="how-it-works-diagram"');
    expect(html).toContain("创建 Workspace 后，写作流程如何展开");
    expect(html).toContain("初始化请求");
    expect(html).toContain("黄金三章");
    expect(html).toContain("正文/NN-标题.md");
    expect(html).toContain(".work/ 试稿与审核");
    expect(html).toContain("<svg");
    expect(html).toContain("不是聊天窗口，而是写作工作台");
    expect(html).toContain("围绕长文本上下文设计");
    expect(html).toContain("数据源和素材可以被 Agent 读取");
    expect(html).toContain("多章节推进，不打断写作节奏");
    expect(html).toContain("审阅不是泛泛评价");
    expect(html).toContain("把你的写作方法沉淀下来");
    expect(html).toContain("版本管理，不怕改坏");
    expect(html).toContain("为写作者保留最终判断权");
    expect(html).toContain("<video");
    expect(html).toContain("controls");
    expect(html).toContain("播放演示");
    expect(html).toContain("storyflow-promo-45s.mp4");
    expect(html).toContain("storyflow-promo-poster.jpg");
    expect(html).toContain("storyflow-workspace.png");
    expect(html).toContain("storyflow-data-source.png");
    expect(html).toContain("storyflow-skills.png");
    expect(html).toContain("storyflow-review-diff.png");
    expect(html).toContain("storyflow-delivery.png");
    expect(html).toContain("storyflow-version-history.png");
    expect(html).not.toContain("traffic-lights");
    expect(html).not.toContain("browser-frame");
    expect(html).not.toContain("window-bar");
  });

  test("keeps primary landing sections on a shared visual width", () => {
    const css = readFileSync(resolve(import.meta.dir, "../styles.css"), "utf8");

    expect(css).toContain("--landing-content-width: 1100px;");
    expect(css).toContain("--landing-read-width: 896px;");

    for (const selector of [
      ".hero-shot",
      ".diagram-section",
      ".text-section",
      ".wide-image",
      ".section-cards",
      ".site-footer",
    ]) {
      expect(css).toMatch(
        new RegExp(`${selector.replace(".", "\\.")}[^{}]*\\{[^}]*max-width: var\\(--landing-content-width\\);`),
      );
    }
  });
});
