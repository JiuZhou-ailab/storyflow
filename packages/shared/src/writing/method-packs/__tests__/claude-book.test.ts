import { describe, expect, it } from "bun:test";
import { getBuiltInMethodPack, getBuiltInMethodPacks } from "../index.ts";

describe("built-in method packs", () => {
  it("exposes all built-in writing method pack ids", () => {
    expect(getBuiltInMethodPacks().map((pack) => pack.id)).toEqual([
      "novel.claude-book",
      "novel.oh-story",
      "novel.crucible",
      "novel.creative-writing",
      "short-form.article",
    ]);
  });

  it("exposes the Claude-Book novel method pack contract", () => {
    const pack = getBuiltInMethodPack("novel.claude-book");

    expect(pack?.id).toBe("novel.claude-book");
    expect(pack?.version).toBe(1);
    expect(pack?.projectType).toBe("novel");
    expect(pack?.storageProfile).toBe("claude-book-compatible");
    expect(pack?.requiredPaths).toContainEqual({
      path: "state/current/situation.md",
      kind: "file",
    });
    expect(pack?.requiredSkills).toContain("chapter-workflow");
    expect(pack?.requiredSkills).toContain("state-updater");
    expect(pack?.starterMessage).toContain("Claude-Book");
  });

  it("exposes the Oh Story web-fiction method pack contract", () => {
    const pack = getBuiltInMethodPack("novel.oh-story");

    expect(pack?.projectType).toBe("novel");
    expect(pack?.storageProfile).toBe("oh-story-compatible");
    expect(pack?.requiredPaths).toContainEqual({
      path: "追踪/伏笔.md",
      kind: "file",
    });
    expect(pack?.requiredSkills).toContain("story-long-write");
    expect(pack?.requiredSkills).toContain("story-deslop");
    expect(pack?.starterMessage).toContain("网文");
  });

  it("exposes the Crucible method pack contract", () => {
    const pack = getBuiltInMethodPack("novel.crucible");

    expect(pack?.projectType).toBe("novel");
    expect(pack?.storageProfile).toBe("crucible-compatible");
    expect(pack?.requiredPaths).toContainEqual({
      path: "planning/forge-points",
      kind: "directory",
    });
    expect(pack?.requiredSkills).toContain("crucible-writer");
    expect(pack?.starterMessage).toContain("36-beat");
  });

  it("exposes the Creative Writing Skills method pack contract", () => {
    const pack = getBuiltInMethodPack("novel.creative-writing");

    expect(pack?.projectType).toBe("novel");
    expect(pack?.storageProfile).toBe("creative-writing-compatible");
    expect(pack?.requiredPaths).toContainEqual({
      path: "kb/canon/facts.md",
      kind: "file",
    });
    expect(pack?.requiredSkills).toContain("prose-writing");
    expect(pack?.requiredSkills).toContain("kb-management");
    expect(pack?.starterMessage).toContain("知识库");
  });

  it("exposes the Short-Form web-fiction method pack contract", () => {
    const pack = getBuiltInMethodPack("short-form.article");

    expect(pack?.projectType).toBe("short-form");
    expect(pack?.storageProfile).toBe("short-form-compatible");
    expect(pack?.requiredPaths).not.toContainEqual({
      path: "目录说明.md",
      kind: "file",
    });
    expect(pack?.requiredPaths).toContainEqual({
      path: "简报.md",
      kind: "file",
    });
    expect(pack?.requiredPaths).toContainEqual({
      path: "大纲.md",
      kind: "file",
    });
    expect(pack?.requiredPaths).toContainEqual({
      path: "人物.md",
      kind: "file",
    });
    expect(pack?.requiredPaths).toContainEqual({
      path: "素材.md",
      kind: "file",
    });
    expect(pack?.requiredPaths).toContainEqual({
      path: "正文",
      kind: "directory",
    });
    expect(pack?.requiredPaths).toContainEqual({
      path: "自由区",
      kind: "directory",
    });
    expect(pack?.requiredPaths).not.toContainEqual({
      path: ".work",
      kind: "directory",
    });
    expect(pack?.requiredPaths).not.toContainEqual({
      path: "草稿",
      kind: "directory",
    });
    expect(pack?.requiredPaths).not.toContainEqual({
      path: "定稿",
      kind: "directory",
    });
    expect(pack?.requiredSkills).toEqual([
      "short-opening-designer",
      "short-golden-three",
      "short-draft-chapter",
      "short-reviser",
    ]);
    expect(pack?.agentIdentity).toBe("");
    expect(pack?.starterMessage).toContain("5,000-30,000");
    expect(pack?.starterMessage).not.toContain("5,000-40,000");
    expect(pack?.starterMessage).toContain("网文");
  });

  it("does not expose the removed Short Drama method pack", () => {
    expect(getBuiltInMethodPack("short-form.drama")).toBeNull();
  });

  it("uses localized and pack-specific starter messages", () => {
    const expectedKeywords: Record<string, string[]> = {
      "novel.claude-book": ["项目圣经", "梗概", "章节计划"],
      "novel.oh-story": ["网文", "平台", "更新节奏"],
      "novel.crucible": ["36-beat", "三条叙事线", "forge points"],
      "novel.creative-writing": ["知识库", "声线", "修订"],
      "short-form.article": ["网文", "skills", "## 文件"],
    };

    for (const pack of getBuiltInMethodPacks()) {
      expect(pack.starterMessage).toMatch(/[\u4e00-\u9fff]/);
      expect(pack.starterMessage).toStartWith("## 这是什么");
      if (pack.id === "short-form.article") {
        expect(pack.starterMessage).toContain("## 文件");
      } else {
        expect(pack.starterMessage).toContain("## 我会怎么做");
        expect(pack.starterMessage).toContain("## 流程");
        expect(pack.starterMessage).toContain("## 你现在可以提供");
      }
      expect(pack.starterMessage).not.toContain("I created");
      expect(pack.starterMessage).not.toContain("Start by");
      for (const keyword of expectedKeywords[pack.id] ?? []) {
        expect(pack.starterMessage).toContain(keyword);
      }
    }
  });

  it("returns null for unknown method packs", () => {
    expect(getBuiltInMethodPack("unknown")).toBeNull();
  });
});
