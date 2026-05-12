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

  it("exposes the Short-Form Writing method pack contract", () => {
    const pack = getBuiltInMethodPack("short-form.article");

    expect(pack?.projectType).toBe("short-form");
    expect(pack?.storageProfile).toBe("short-form-compatible");
    expect(pack?.requiredPaths).toContainEqual({
      path: "brief/reader-promise.md",
      kind: "file",
    });
    expect(pack?.requiredSkills).toContain("short-drafter");
    expect(pack?.requiredSkills).toContain("short-editor");
    expect(pack?.starterMessage).toContain("短文");
  });

  it("uses localized and pack-specific starter messages", () => {
    const expectedKeywords: Record<string, string[]> = {
      "novel.claude-book": ["项目圣经", "梗概", "章节计划"],
      "novel.oh-story": ["网文", "平台", "更新节奏"],
      "novel.crucible": ["36-beat", "三条叙事线", "forge points"],
      "novel.creative-writing": ["知识库", "声线", "修订"],
      "short-form.article": ["短文", "目标读者", "平台"],
    };

    for (const pack of getBuiltInMethodPacks()) {
      expect(pack.starterMessage).toMatch(/[\u4e00-\u9fff]/);
      expect(pack.starterMessage).toStartWith("## 这是什么");
      expect(pack.starterMessage).toContain("## 我会怎么做");
      expect(pack.starterMessage).toContain("## 流程");
      expect(pack.starterMessage).toContain("## 你现在可以提供");
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
